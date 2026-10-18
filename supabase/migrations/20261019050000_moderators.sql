-- Moderator roles.
--
-- Moderators can: work the review queue (submissions, ChatGPT finds,
-- imported songs, sub-versions), edit songs (details, status, adding songs
-- and artists, featured links, genre tags), merge duplicates and delete
-- songs. Everything they do lands in the undo history like your own changes.
--
-- Admin only (unchanged): deleting or renaming artists, artist profiles,
-- takedowns, auto-approve settings, the undo history, health, the artist
-- queue and choosing moderators.
--
-- Manage moderators on /admin/moderators.

create table if not exists moderators (
  user_id uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now(),
  note text
);
alter table moderators enable row level security;
drop policy if exists moderators_read on moderators;
create policy moderators_read on moderators for select
  using ((select is_admin()) or user_id = (select auth.uid()));
revoke insert, update, delete on moderators from anon, authenticated;

create or replace function is_moderator()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select is_admin() or (
    not is_oauth_client()
    and exists (select 1 from moderators where user_id = auth.uid()));
$$;
grant execute on function is_moderator() to anon, authenticated;

-- 'admin', 'moderator' or null, for the site to decide what to show.
create or replace function rpc_my_role()
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select case when is_admin() then 'admin' when is_moderator() then 'moderator' end;
$$;
grant execute on function rpc_my_role() to anon, authenticated;

-- Let moderators use the functions they need.
do $$
declare
  f record;
  d text;
  n int := 0;
begin
  for f in
    select p.oid from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
      and p.proname = any (array[
        -- review queue
        'approve_submission', 'reject_submission', 'approve_status_change',
        'approve_discovery', 'dismiss_discovery', 'promote_discovery',
        'admin_import_suggestions', 'admin_apply_import_suggestions', 'admin_dismiss_import_suggestions',
        'admin_version_suggestions', 'admin_apply_version_suggestions', 'admin_dismiss_version_suggestions',
        'admin_scan_versions',
        -- editing songs
        'admin_add_track', 'admin_update_track', 'admin_set_release_status', 'admin_create_artist',
        'admin_add_track_appearance', 'admin_remove_track_appearance',
        'add_or_vote_genre_tag', 'admin_delete_genre_tag',
        -- duplicates
        'admin_merge_duplicates', 'admin_merge_track', 'admin_quick_merge',
        'dismiss_duplicate_group', 'find_identical_duplicates',
        -- deleting songs
        'admin_delete_track',
        -- undo batches for all of the above
        'sc_begin_batch'])
  loop
    d := pg_get_functiondef(f.oid);
    if d ~ 'is_admin\(\)' then
      execute regexp_replace(d, 'is_admin\(\)', 'is_moderator()', 'g');
      n := n + 1;
    end if;
  end loop;
  raise notice 'moderators can now use % functions', n;
end $$;

-- And read what the review pages show.
drop policy if exists "Admin reads discoveries" on discoveries;
create policy "Admin reads discoveries" on discoveries for select using ((select is_moderator()));
drop policy if exists "Admin or owner reads evidence" on discovery_evidence;
create policy "Admin or owner reads evidence" on discovery_evidence for select
  using ((select is_moderator()) or (select auth.uid()) = user_id);
drop policy if exists "Admin reads dismissals" on duplicate_dismissals;
create policy "Admin reads dismissals" on duplicate_dismissals for select using ((select is_moderator()));
drop policy if exists "Admin or owner reads duplicate reports" on duplicate_reports;
create policy "Admin or owner reads duplicate reports" on duplicate_reports for select
  using ((select is_moderator()) or (select auth.uid()) = user_id);
drop policy if exists import_runs_admin_read on import_runs;
create policy import_runs_admin_read on import_runs for select
  using ((select is_moderator()) or requested_by = (select auth.uid()));
drop policy if exists import_suggestions_admin_read on import_suggestions;
create policy import_suggestions_admin_read on import_suggestions for select using ((select is_moderator()));
drop policy if exists version_suggestions_admin_read on version_suggestions;
create policy version_suggestions_admin_read on version_suggestions for select using ((select is_moderator()));

-- ---------------------------------------------------------------------------
-- Choosing moderators (admin only)
-- ---------------------------------------------------------------------------

create or replace function admin_list_moderators()
returns table (user_id uuid, display_name text, avatar_url text, added_at timestamptz, note text, actions bigint)
language sql
stable
security definer
set search_path to 'public'
as $$
  select m.user_id, p.display_name, p.avatar_url, m.added_at, m.note,
         (select count(*) from change_batches b where b.created_by = m.user_id)
  from moderators m left join profiles p on p.id = m.user_id
  where is_admin()
  order by m.added_at;
$$;

create or replace function admin_set_moderator(p_user uuid, p_on boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  if p_on then
    insert into moderators (user_id, note) values (p_user, nullif(trim(p_note), ''))
    on conflict (user_id) do update set note = coalesce(excluded.note, moderators.note);
  else
    delete from moderators where user_id = p_user;
  end if;
end;
$$;

-- Find people by display name to make them moderators.
create or replace function admin_find_people(p_query text)
returns table (user_id uuid, display_name text, avatar_url text, is_moderator boolean, contributions bigint)
language sql
stable
security definer
set search_path to 'public'
as $$
  select p.id, p.display_name, p.avatar_url,
         exists (select 1 from moderators m where m.user_id = p.id),
         (select count(*) from sc_contribution_events(p.id))
  from profiles p
  where is_admin() and length(trim(coalesce(p_query, ''))) >= 2
    and p.display_name ilike '%' || trim(p_query) || '%'
  order by p.display_name
  limit 20;
$$;

revoke execute on function admin_list_moderators(), admin_set_moderator(uuid, boolean, text), admin_find_people(text)
  from public, anon;
grant execute on function admin_list_moderators(), admin_set_moderator(uuid, boolean, text), admin_find_people(text)
  to authenticated;
