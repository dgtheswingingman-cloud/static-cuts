-- Tidy-up and speed-ups from the Supabase advisors.
--
-- 1. Row security checks: auth.uid() / auth.email() / is_admin() in policies
--    were worked out again for every row. Wrapped in (select ...) they're
--    worked out once per query, which matters on big tables (ratings,
--    collections, follows). Same rules, just faster.
-- 2. submissions had three read policies; one of them already lets everyone
--    read submissions (for the changelog), so the other two only cost time.
-- 3. Indexes on links that are looked up or deleted through often (a song's
--    collections, redirects, finds and suggestions).
-- 4. Removed: the old six-field admin_update_track (the site uses the full
--    one) and migrate_featured_artists_to_links (a one-off from the start).
-- 5. Internal helpers can no longer be called directly from the website's
--    API; the functions that use them still can.

-- 1 ---------------------------------------------------------------------------
do $$
declare
  p record;
  v_using text;
  v_check text;
  wrap text := '\m(auth\.uid|auth\.email|auth\.jwt|is_admin)\(\)';
begin
  for p in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (coalesce(qual, '') ~ wrap or coalesce(with_check, '') ~ wrap)
  loop
    -- Skip anything already wrapped.
    continue when coalesce(p.qual, '') ~* 'select\s+(auth\.|is_admin)' or coalesce(p.with_check, '') ~* 'select\s+(auth\.|is_admin)';
    v_using := regexp_replace(p.qual, wrap, '(select \1())', 'g');
    v_check := regexp_replace(p.with_check, wrap, '(select \1())', 'g');
    execute format('alter policy %I on %I.%I%s%s', p.policyname, p.schemaname, p.tablename,
      case when v_using is not null then ' using (' || v_using || ')' else '' end,
      case when v_check is not null then ' with check (' || v_check || ')' else '' end);
  end loop;
end $$;

-- 2 ---------------------------------------------------------------------------
drop policy if exists "Admin can read all submissions" on submissions;
drop policy if exists "Users can read their own submissions" on submissions;

-- 3 ---------------------------------------------------------------------------
create index if not exists track_ownership_track_idx on track_ownership (track_id);
create index if not exists track_redirects_new_track_idx on track_redirects (new_track_id);
create index if not exists discoveries_matched_track_idx on discoveries (matched_track_id) where matched_track_id is not null;
create index if not exists discoveries_parent_track_idx on discoveries (parent_track_id) where parent_track_id is not null;
create index if not exists version_suggestions_parent_idx on version_suggestions (parent_track_id) where parent_track_id is not null;
create index if not exists comments_user_idx on comments (user_id);
create index if not exists takedown_requests_track_idx on takedown_requests (track_id) where track_id is not null;
create index if not exists artist_queue_claims_artist_idx on artist_queue_claims (artist_id);
create index if not exists import_suggestions_run_idx on import_suggestions (run_id) where run_id is not null;
create index if not exists change_batches_undo_of_idx on change_batches (undo_of) where undo_of is not null;

-- 4 ---------------------------------------------------------------------------
drop function if exists admin_update_track(text, text, text, boolean, boolean, boolean);
drop function if exists migrate_featured_artists_to_links();

-- 5 ---------------------------------------------------------------------------
revoke execute on function sc_find_artist(text) from public, anon, authenticated;
revoke execute on function sc_match_tracks(text, text) from public, anon, authenticated;
revoke execute on function sc_resolve_artists(text, text[]) from public, anon, authenticated;
revoke execute on function sc_begin_batch(text, text) from public, anon, authenticated;
revoke execute on function sc_job_batch(text, text) from public, anon, authenticated;
grant execute on function sc_begin_batch(text, text), sc_job_batch(text, text) to service_role;

analyze tracks;
analyze track_ownership;
analyze ratings;

select tablename, policyname, qual, with_check from pg_policies
where schemaname = 'public' and (qual ~ 'auth\.uid' or with_check ~ 'auth\.uid')
order by tablename limit 5;
