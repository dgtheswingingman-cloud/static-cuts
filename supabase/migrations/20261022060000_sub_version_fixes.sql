-- Sub-versions: counts that match the page, and clear versions linked
-- automatically again.
--
-- 1. The "rescan" button found clear versions (Remix, Acoustic, V1…) but
--    never linked them, so they sat in the list unseen. Rescans now link the
--    clear ones whose main song is already on the page, and this links the
--    327 waiting now (one undo batch).
-- 2. Clear versions whose main song isn't on the page yet (1,529, mostly from
--    Genius imports: live albums, mixes, reworks) aren't linked blindly: they
--    get their own "needs a main song" list on the page.
-- 3. Counts per list for the page, so the numbers are right however long a
--    list is.

create or replace function admin_scan_versions(p_artist_ids text[] default null)
returns int
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_n int;
  v_ids uuid[];
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  v_n := sc_scan_versions(p_artist_ids);
  select array_agg(vs.id) into v_ids
  from version_suggestions vs join tracks t on t.id = vs.track_id
  where vs.state = 'open' and vs.cls = 'sure' and vs.action = 'link'
    and (p_artist_ids is null or t.artist_id = any (p_artist_ids));
  if v_ids is not null then
    perform set_config('static_cuts.batch_id', '', true);
    perform sc_begin_batch('sub_versions', 'Sub-versions: clear ones linked after a rescan');
    perform sc_apply_version_suggestions(v_ids);
  end if;
  return v_n;
end;
$$;

create or replace function admin_version_counts()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select case when is_moderator() then coalesce(jsonb_object_agg(cls, n), '{}'::jsonb) end
  from (select cls, count(*) n from version_suggestions where state = 'open' group by cls) x;
$$;
revoke execute on function admin_version_counts() from public, anon;
grant execute on function admin_version_counts() to authenticated;

do $$
declare
  v_ids uuid[];
begin
  select array_agg(id) into v_ids from version_suggestions where state = 'open' and cls = 'sure' and action = 'link';
  if v_ids is not null then
    perform set_config('static_cuts.batch_id', '', true);
    perform sc_begin_batch('sub_versions', 'Sub-versions: clear ones that were waiting');
    perform sc_apply_version_suggestions(v_ids);
  end if;
end $$;

select cls, action, count(*) from version_suggestions where state = 'open' group by 1, 2 order by 1, 2;
