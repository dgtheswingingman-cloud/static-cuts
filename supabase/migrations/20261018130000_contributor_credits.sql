-- Contributor credits.
--
-- Each song remembers who it's credited to (tracks.added_by):
--   approved submissions        -> the person who submitted it
--   approved ChatGPT finds      -> the person whose ChatGPT found it first
--   imports                     -> the person who ran the import
-- Credits count only what was approved and added; nothing for pending or
-- rejected work.
--
-- What counts on a profile:
--   songs added, versions added, status updates, corrections, finds (first
--   to report a find that was approved) and confirmations (reported an
--   approved find someone else reported first).
--
-- Privacy: profiles.show_contributions (on by default, like the other
-- profile settings). Hidden contributions don't appear on the profile, the
-- contributors page or "Added by" on songs.

alter table profiles add column if not exists show_contributions boolean not null default true;

-- Who a new song is credited to. Imports set static_cuts.credit_user for the
-- duration of the call; everything else fills it in afterwards.
alter table tracks add column if not exists added_by uuid;
alter table tracks alter column added_by set default nullif(current_setting('static_cuts.credit_user', true), '')::uuid;
create index if not exists tracks_added_by_idx on tracks (added_by, created_at) where added_by is not null;

-- Approved submissions credit the submitter, or the original finder when
-- the submission came from a ChatGPT find.
create or replace function submissions_credit_track()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved'
     and new.resulting_id is not null and new.type in ('new_track', 'new_version') then
    update tracks set added_by = coalesce(
        (select d.first_seen_by from discoveries d where d.submission_id = new.id limit 1),
        new.submitted_by)
    where id = new.resulting_id and added_by is null;
  end if;
  return new;
end;
$$;
drop trigger if exists submissions_credit_track on submissions;
create trigger submissions_credit_track after update of status on submissions
for each row execute function submissions_credit_track();

-- Imports: credit the person who ran the import.
do $$
declare
  d text;
begin
  select pg_get_functiondef('public.sc_import_add_tracks(uuid, jsonb)'::regprocedure) into d;
  if d not like '%static_cuts.credit_user%' then
    d := replace(d,
      'perform sc_begin_batch(''import'', ''Spotify import: '' || v_name);',
      'perform sc_begin_batch(''import'', ''Spotify import: '' || v_name);' || chr(10) ||
      '  perform set_config(''static_cuts.credit_user'', coalesce(r.requested_by::text, ''''), true);');
    if d not like '%static_cuts.credit_user%' then raise exception 'could not add credits to sc_import_add_tracks'; end if;
    execute d;
  end if;

  select pg_get_functiondef('public.admin_apply_import_suggestions(uuid[], text)'::regprocedure) into d;
  if d not like '%static_cuts.credit_user%' then
    d := replace(d,
      'v_id := v_home || ''-'' || substr(replace(gen_random_uuid()::text, ''-'', ''''), 1, 10);',
      'perform set_config(''static_cuts.credit_user'', coalesce((select requested_by::text from import_runs where id = s.run_id), ''''), true);' || chr(10) ||
      '    v_id := v_home || ''-'' || substr(replace(gen_random_uuid()::text, ''-'', ''''), 1, 10);');
    if d not like '%static_cuts.credit_user%' then raise exception 'could not add credits to admin_apply_import_suggestions'; end if;
    execute d;
  end if;
end $$;

-- Backfill what we can.
update tracks t set added_by = coalesce(
    (select d.first_seen_by from discoveries d where d.submission_id = s.id limit 1), s.submitted_by)
from submissions s
where s.resulting_id = t.id and s.status = 'approved' and s.type in ('new_track', 'new_version') and t.added_by is null;

update tracks t set added_by = r.requested_by
from import_suggestions s join import_runs r on r.id = s.run_id
where s.state = 'applied' and t.added_by is null and t.source = s.source
  and t.artist_id = s.artist_id and t.title = s.title;

-- ---------------------------------------------------------------------------
-- Reading credits
-- ---------------------------------------------------------------------------

-- Whether someone's contributions can be shown to the current viewer.
create or replace function sc_contributions_visible(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select p_user = auth.uid() or is_admin()
      or coalesce((select show_contributions from profiles where id = p_user), false);
$$;

-- Every approved contribution, one row each.
create or replace function sc_contribution_events(p_user uuid default null, p_since timestamptz default null)
returns table (user_id uuid, kind text, at timestamptz, track_id text, title text, artist_id text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select t.added_by,
         case when t.parent_track_id is null then 'song' else 'version' end,
         coalesce(t.created_at, now()), t.id, t.title, t.artist_id
  from tracks t
  where t.added_by is not null and (p_user is null or t.added_by = p_user)
    and (p_since is null or t.created_at >= p_since)
  union all
  select s.submitted_by,
         case when s.type = 'status_change' then 'status' else 'correction' end,
         coalesce(s.reviewed_at, s.created_at), nullif(s.payload ->> 'track_id', ''),
         coalesce(s.payload ->> 'track_title', s.payload ->> 'title', (select title from tracks where id = s.payload ->> 'track_id')),
         s.artist_id
  from submissions s
  where s.status = 'approved' and s.type in ('status_change', 'correction', 'flag_link', 'flag_deletion')
    and (p_user is null or s.submitted_by = p_user)
    and (p_since is null or coalesce(s.reviewed_at, s.created_at) >= p_since)
  union all
  select e.user_id,
         case when e.user_id = d.first_seen_by then 'find' else 'confirmation' end,
         coalesce(d.reviewed_at, e.created_at), d.matched_track_id,
         d.title || coalesce(' (' || d.version_hint || ')', ''), coalesce(d.main_artist_id, d.artist_id)
  from discovery_evidence e join discoveries d on d.id = e.discovery_id
  where d.state = 'promoted'
    and (p_user is null or e.user_id = p_user)
    and (p_since is null or coalesce(d.reviewed_at, e.created_at) >= p_since)
    -- A find that became a song is already counted as the song, for the finder.
    and not (e.user_id = d.first_seen_by and exists (
      select 1 from submissions s join tracks t on t.id = s.resulting_id
      where s.id = d.submission_id and t.added_by = e.user_id));
$$;

-- A profile's contributions: totals and the 30 most recent.
create or replace function rpc_user_contributions(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v jsonb;
begin
  if not sc_contributions_visible(p_user) then
    return jsonb_build_object('visible', false);
  end if;
  select jsonb_build_object(
    'visible', true,
    'totals', (select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb)
               from (select kind, count(*) n from sc_contribution_events(p_user) group by kind) x),
    'total', (select count(*) from sc_contribution_events(p_user)),
    'recent', (select coalesce(jsonb_agg(to_jsonb(r) order by r.at desc), '[]'::jsonb) from (
                 select e.kind, e.at, e.track_id, e.title, e.artist_id, a.name as artist_name
                 from sc_contribution_events(p_user) e left join artists a on a.id = e.artist_id
                 order by e.at desc limit 30) r)
  ) into v;
  return v;
end;
$$;

-- Leaderboard. p_days null = all time.
create or replace function rpc_top_contributors(p_days int default 30, p_limit int default 50)
returns table (user_id uuid, display_name text, avatar_url text, total bigint, songs bigint, versions bigint,
               status bigint, corrections bigint, finds bigint, confirmations bigint)
language sql
stable
security definer
set search_path to 'public'
as $$
  select e.user_id, p.display_name, p.avatar_url, count(*),
         count(*) filter (where e.kind = 'song'), count(*) filter (where e.kind = 'version'),
         count(*) filter (where e.kind = 'status'), count(*) filter (where e.kind = 'correction'),
         count(*) filter (where e.kind = 'find'), count(*) filter (where e.kind = 'confirmation')
  from sc_contribution_events(null, case when p_days is null then null else now() - make_interval(days => p_days) end) e
  join profiles p on p.id = e.user_id
  where p.show_contributions
  group by e.user_id, p.display_name, p.avatar_url
  order by count(*) desc, p.display_name
  limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;

-- "Added by" names for a set of songs, respecting privacy.
create or replace function rpc_track_credits(p_track_ids text[])
returns table (track_id text, user_id uuid, display_name text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select t.id, t.added_by, p.display_name
  from tracks t join profiles p on p.id = t.added_by
  where t.id = any (p_track_ids[1:500]) and sc_contributions_visible(t.added_by);
$$;

revoke execute on function sc_contributions_visible(uuid), sc_contribution_events(uuid, timestamptz),
  submissions_credit_track() from public, anon, authenticated;
grant execute on function rpc_user_contributions(uuid), rpc_top_contributors(int, int), rpc_track_credits(text[])
  to anon, authenticated;

select (select count(*) from tracks where added_by is not null) as songs_credited;
