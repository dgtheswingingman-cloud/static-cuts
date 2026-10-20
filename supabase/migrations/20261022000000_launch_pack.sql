-- Launch pack (run after 20261021020000_speed_fixes.sql):
--  1. Security tidy: background trigger functions can't be called from
--     outside; fixed search paths; two missing indexes.
--  2. Tracker re-checks that fail are retried after an hour, not a day.
--  3. Health page: tracker status, artists by how much is checked, simple
--     site stats, and searches that found nothing.
--  4. First visit: follow your picks after signing up (the picks are kept
--     in the browser until then).
--  5. Searches that found nothing are counted (the words only, no user).

-- ----------------------------------------------------------------- 1

do $$
declare
  f record;
begin
  -- Trigger functions run by themselves; nobody needs to call them.
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prorettype = 'trigger'::regtype loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
  -- Fixed search path for the helpers the checker flagged.
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('sc_parse_sheet_url', 'sc_sheet_wait', 'sheet_sources_schedule',
             'sheet_sources_first_schedule', 'sc_leak_date_from_notes', 'sc_split_names', 'sc_guest_name') loop
    execute format('alter function %s set search_path = public', f.sig);
  end loop;
end $$;

create index if not exists tracker_disagreements_source on tracker_disagreements (source_id);
create index if not exists version_votes_user on version_votes (user_id);

-- ----------------------------------------------------------------- 2

create or replace function sc_sheet_sync_due(p_secret text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then
    raise exception 'not authorized';
  end if;
  return jsonb_build_object(
    'user_id', (select id from auth.users where email = 'dg.theswingingman@gmail.com'),
    'sources', (select coalesce(jsonb_agg(id), '[]'::jsonb) from (
      select s.id from sheet_sources s
      where s.auto_sync
        and (
          -- Due as usual (at most daily) ...
          (coalesce(s.next_check_at, now()) <= now()
           and (s.last_synced_at is null or s.last_synced_at < now() - interval '1 day'))
          -- ... or the last try failed: try again after an hour.
          or (s.last_result ? 'error' and s.last_synced_at < now() - interval '1 hour'))
      order by (s.last_result ? 'error') ,
               (select count(*) from follows f where f.artist_id = s.artist_id)
             + (select count(*) from artist_requests r where r.artist_id = s.artist_id and r.created_at > now() - interval '30 days') desc,
               s.next_check_at nulls first
      limit 1) x));
end;
$$;

-- ----------------------------------------------------------------- 3

-- Trackers for the health page.
create or replace function admin_tracker_status()
returns table (id uuid, title text, artist_id text, artist text, auto_sync boolean, last_synced_at timestamptz,
               next_check_at timestamptz, error text, statuses int, details int, disagree int, suggested int, open_disagreements bigint)
language sql
stable
security definer
set search_path to 'public'
as $$
  select s.id, s.title, s.artist_id, a.name, s.auto_sync, s.last_synced_at, s.next_check_at,
         s.last_result ->> 'error', (s.last_result ->> 'statuses')::int, (s.last_result ->> 'details')::int,
         (s.last_result ->> 'disagree')::int, (s.last_result ->> 'suggested')::int,
         (select count(*) from tracker_disagreements d where d.source_id = s.id and d.state = 'open')
  from sheet_sources s left join artists a on a.id = s.artist_id
  where is_moderator()
  order by s.title;
$$;
revoke execute on function admin_tracker_status() from public, anon;
grant execute on function admin_tracker_status() to authenticated;

-- How much of each artist's page has a real status, followers first: for
-- picking launch artists and seeing where checking is needed.
create or replace function admin_artist_checked(p_limit int default 40)
returns table (artist_id text, artist text, songs bigint, checked bigint, pct int, followers bigint, has_tracker boolean)
language sql
stable
security definer
set search_path to 'public'
as $$
  select a.id, a.name, count(t.id), count(t.id) filter (where coalesce(t.release_status, 'unconfirmed') <> 'unconfirmed'),
         case when count(t.id) > 0 then (100 * count(t.id) filter (where coalesce(t.release_status, 'unconfirmed') <> 'unconfirmed') / count(t.id))::int end,
         (select count(*) from follows f where f.artist_id = a.id),
         exists (select 1 from sheet_sources s where s.artist_id = a.id)
  from artists a join tracks t on t.artist_id = a.id and t.parent_track_id is null
  where is_moderator()
  group by a.id, a.name
  having count(t.id) >= 10
  order by (select count(*) from follows f where f.artist_id = a.id) desc, count(t.id) desc
  limit greatest(1, least(coalesce(p_limit, 40), 200));
$$;
revoke execute on function admin_artist_checked(int) from public, anon;
grant execute on function admin_artist_checked(int) to authenticated;

-- Searches that found nothing: the words only, counted. No user is stored.
create table if not exists search_misses (
  query text not null,
  kind text not null default 'songs' check (kind in ('songs', 'artists')),
  times int not null default 1,
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  primary key (kind, query)
);
alter table search_misses enable row level security;
revoke all on search_misses from anon, authenticated;

create or replace function rpc_log_search_miss(p_query text, p_kind text default 'songs')
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  q text := lower(regexp_replace(trim(coalesce(p_query, '')), '\s+', ' ', 'g'));
begin
  if length(q) < 3 or length(q) > 80 or p_kind not in ('songs', 'artists') then return; end if;
  insert into search_misses (query, kind) values (q, p_kind)
  on conflict (kind, query) do update set times = search_misses.times + 1, last_at = now();
end;
$$;
grant execute on function rpc_log_search_miss(text, text) to anon, authenticated;

create or replace function admin_search_misses(p_days int default 30)
returns table (query text, kind text, times int, last_at timestamptz, now_found boolean)
language sql
stable
security definer
set search_path to 'public'
as $$
  select m.query, m.kind, m.times, m.last_at,
         case when m.kind = 'artists' then sc_find_artist(m.query) is not null
              else exists (select 1 from tracks t where position(m.query in lower(t.title)) > 0) end
  from search_misses m
  where is_moderator() and m.last_at > now() - make_interval(days => greatest(1, coalesce(p_days, 30)))
  order by m.times desc, m.last_at desc
  limit 60;
$$;
revoke execute on function admin_search_misses(int) from public, anon;
grant execute on function admin_search_misses(int) to authenticated;

-- Simple site stats: are people signing up, coming back and helping?
-- "Active" = followed, collected, rated, commented, suggested or voted.
create or replace function admin_site_stats()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  with acts as (
    select user_id, followed_at at_ts from follows
    union all select user_id, collected_at from track_ownership
    union all select user_id, updated_at from ratings
    union all select user_id, created_at from comments
    union all select submitted_by, created_at from submissions where submitted_by is not null
    union all select user_id, created_at from wanted_votes
    union all select user_id, created_at from version_votes
  ),
  people as (
    select user_id, min(at_ts) first_at, max(at_ts) last_at, count(distinct (at_ts at time zone 'Europe/London')::date) days
    from acts group by user_id
  )
  select case when is_admin() then jsonb_build_object(
    'accounts', (select count(*) from auth.users),
    'new_7d', (select count(*) from auth.users where created_at > now() - interval '7 days'),
    'new_30d', (select count(*) from auth.users where created_at > now() - interval '30 days'),
    'active_7d', (select count(*) from people where last_at > now() - interval '7 days'),
    'active_30d', (select count(*) from people where last_at > now() - interval '30 days'),
    -- came back: active on a day at least a week after their first.
    'returning', (select count(*) from people p where exists (
        select 1 from acts a where a.user_id = p.user_id and a.at_ts >= p.first_at + interval '7 days')),
    'contributors_30d', (select count(distinct submitted_by) from submissions where created_at > now() - interval '30 days'),
    'missed_searches_7d', (select coalesce(sum(times), 0) from search_misses where last_at > now() - interval '7 days'),
    'push_devices', (select count(*) from push_subscriptions where failed_at is null)
  ) end;
$$;
revoke execute on function admin_site_stats() from public, anon;
grant execute on function admin_site_stats() to authenticated;

-- ----------------------------------------------------------------- 4

-- After signing up: follow the artists picked on the first-visit page.
create or replace function rpc_follow_many(p_artist_ids text[])
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  n int;
begin
  if auth.uid() is null or is_oauth_client() then raise exception 'Sign in first.'; end if;
  insert into follows (user_id, artist_id)
  select auth.uid(), a.id from artists a where a.id = any (p_artist_ids[1:50])
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function rpc_follow_many(text[]) from public, anon;
grant execute on function rpc_follow_many(text[]) to authenticated;

select 'done' as result;
