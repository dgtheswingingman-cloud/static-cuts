-- The database was busy: the artist queue (used by the import timers every
-- 2 minutes and the control room) counted every artist's songs one by one,
-- 11-14 s a time now Kanye and Uzi have 17,000+ songs between them. It now
-- reads the saved song counts (artist_track_counts, refreshed every 10
-- minutes). Same order, same reasons. The cap goes from 500 to 5000 artists:
-- with 931 artists the import timers never saw the bottom 431, so the
-- "every artist checked" sweep (new artists step) could never finish.

create or replace function sc_artist_queue(p_limit integer default 50, p_only_due boolean default true)
returns table(artist_id text, name text, score numeric, due boolean, next_due_at timestamp with time zone, track_count bigint, followers bigint, requests bigint, last_checked_at timestamp with time zone, quiet_streak integer, reasons text[])
language sql
stable
security definer
set search_path to 'public'
as $$
  with base as (
    select a.id, a.name,
      coalesce(tc.n, 0)::bigint as n_tracks,
      coalesce(f.n, 0)::bigint as n_followers,
      coalesce(r.n, 0)::bigint as n_requests,
      rs.last_researched_at, rs.next_due_at, coalesce(rs.quiet_streak, 0) as streak, rs.last_found_at
    from artists a
    left join artist_track_counts tc on tc.artist_id = a.id
    left join (select f.artist_id, count(*) n from follows f group by 1) f on f.artist_id = a.id
    left join (select r.artist_id, count(*) n from artist_requests r where r.created_at > now() - interval '30 days' group by 1) r on r.artist_id = a.id
    left join artist_research_state rs on rs.artist_id = a.id
  ),
  scored as (
    select b.*,
      -- Interest: followers (1 = 28, 3 = 55, 10 = 96 points) and requests.
      (round(40 * ln(1 + b.n_followers)::numeric, 1)
       + least(b.n_requests, 10) * 20
       -- Thin or never-checked pages: full boost when someone's interested,
       -- a quarter otherwise.
       + (case when b.n_tracks = 0 then 40 when b.n_tracks <= 10 then 25 when b.n_tracks <= 50 then 8 else 0 end
          + case when b.last_researched_at is null then 15 else 0 end)
         * case when b.n_followers > 0 or b.n_requests > 0 then 1 else 0.25 end
       + case when b.last_found_at > now() - interval '14 days' then 25 else 0 end
       -- Overdue artists creep up the longer they wait.
       + least(greatest(extract(epoch from (now() - coalesce(b.next_due_at, now()))) / 86400.0, 0), 30)
      )::numeric as score,
      (b.next_due_at is null or b.next_due_at <= now()) as is_due
    from base b
  )
  select s.id, s.name, s.score, s.is_due, s.next_due_at, s.n_tracks, s.n_followers, s.n_requests,
    s.last_researched_at, s.streak,
    array_remove(array[
      case when s.n_followers > 0 then s.n_followers || ' follower' || case when s.n_followers = 1 then '' else 's' end end,
      case when s.n_requests > 0 then s.n_requests || ' request' || case when s.n_requests = 1 then '' else 's' end end,
      case when s.n_tracks = 0 then 'empty page' when s.n_tracks <= 10 then 'only ' || s.n_tracks || case when s.n_tracks = 1 then ' song' else ' songs' end end,
      case when s.last_researched_at is null then 'never checked' end,
      case when s.last_found_at > now() - interval '14 days' then 'new music found recently' end,
      case when s.streak >= 2 then 'quiet (' || s.streak || ' checks with nothing new)' end,
      case when not s.is_due then 'next check ' || to_char(s.next_due_at at time zone 'Europe/London', 'DD Mon HH24:MI') end
    ], null)
  from scored s
  where (not p_only_due or s.is_due)
  order by s.is_due desc, s.score desc, s.last_researched_at nulls first
  limit greatest(1, least(coalesce(p_limit, 50), 5000));
$$;

-- ---------------------------------------------------------------------------
-- Control room: "last hour" counts and "last one" lookups read every song.
-- Small indexes make them instant.
-- ---------------------------------------------------------------------------
create index if not exists tracks_genius_checked_idx on tracks (genius_checked_at) where genius_checked_at is not null;
create index if not exists tracks_spotify_attempt_idx on tracks (spotify_search_attempted_at) where spotify_search_attempted_at is not null;
create index if not exists tracks_cover_checked_idx on tracks (cover_checked_at) where cover_checked_at is not null;

-- Timer history: 53,000 rows and growing (every job, every minute). Keep 3 days.
create or replace function sc_cron_history_trim()
returns integer
language plpgsql
security definer
set search_path to 'public', 'cron'
as $$
declare
  v_n int;
begin
  delete from cron.job_run_details where end_time < now() - interval '3 days';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke execute on function sc_cron_history_trim() from public, anon, authenticated;
select sc_cron_history_trim();
select cron.unschedule(jobid) from cron.job where jobname = 'cron-history-trim';
select cron.schedule('cron-history-trim', '47 4 * * *', 'select sc_cron_history_trim()');

-- ---------------------------------------------------------------------------
-- Release radar: visitors no longer rebuild it (1.5 s, more when busy, and
-- the limit for visitors is 3 s). A background job rebuilds it every 2
-- minutes; visitors always get the saved copy.
-- ---------------------------------------------------------------------------
create or replace function sc_release_radar_refresh()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into home_cache (key, data, refreshed_at) values ('radar', sc_release_radar_live(), now())
  on conflict (key) do update set data = excluded.data, refreshed_at = excluded.refreshed_at;
end;
$$;
revoke execute on function sc_release_radar_refresh() from public, anon, authenticated;

create or replace function rpc_release_radar()
returns table(section text, track_id text, title text, artist_id text, artist text, album text, release_date date, status text, spotify_url text, watchers bigint, watching boolean, cover_url text)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_data jsonb;
begin
  select data into v_data from home_cache where key = 'radar';
  if v_data is null then
    v_data := sc_release_radar_live();
    insert into home_cache (key, data, refreshed_at) values ('radar', v_data, now())
    on conflict (key) do update set data = excluded.data, refreshed_at = excluded.refreshed_at;
  end if;
  return query
    select r.section, r.track_id, r.title, r.artist_id, r.artist, r.album, r.release_date, r.status, r.spotify_url,
           r.watchers, exists (select 1 from radar_watches w where w.track_id = r.track_id and w.user_id = auth.uid()),
           r.cover_url
    from jsonb_to_recordset(v_data) as r(section text, track_id text, title text, artist_id text, artist text, album text,
                                         release_date date, status text, spotify_url text, watchers bigint, cover_url text, ord bigint)
    order by r.ord;
end;
$$;
grant execute on function rpc_release_radar() to anon, authenticated;
select sc_release_radar_refresh();
select cron.unschedule(jobid) from cron.job where jobname = 'radar-cache';
select cron.schedule('radar-cache', '1-59/2 * * * *', 'select sc_release_radar_refresh()');

-- ---------------------------------------------------------------------------
-- Sitemap: the later parts timed out (skipping 120,000+ songs each time,
-- 4-5 s against a 3 s limit), so search engines got empty parts. The song
-- lists are now saved once a day. 40,000 songs a part.
-- ---------------------------------------------------------------------------
create table if not exists sitemap_parts (
  part integer primary key,
  songs jsonb not null default '[]'::jsonb,
  refreshed_at timestamptz not null default now()
);
alter table sitemap_parts enable row level security;

create or replace function sc_sitemap_refresh()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_parts int;
begin
  insert into sitemap_parts (part, songs, refreshed_at)
  select p, jsonb_agg(id order by id), now()
  from (select id, ((row_number() over (order by id)) - 1) / 40000 as p from tracks) x
  group by p
  on conflict (part) do update set songs = excluded.songs, refreshed_at = excluded.refreshed_at;
  select max(part) + 1 into v_parts from sitemap_parts where refreshed_at = now();
  update sitemap_parts set songs = '[]'::jsonb, refreshed_at = now() where part >= coalesce(v_parts, 0);
  return coalesce(v_parts, 0);
end;
$$;
revoke execute on function sc_sitemap_refresh() from public, anon, authenticated;

create or replace function rpc_sitemap_part(p_offset integer default 0, p_limit integer default 40000)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select jsonb_build_object(
    'artists', case when coalesce(p_offset, 0) = 0
                    then (select coalesce(jsonb_agg(id order by id), '[]'::jsonb) from artists) else '[]'::jsonb end,
    'songs', coalesce((select songs from sitemap_parts where part = greatest(coalesce(p_offset, 0), 0) / 40000), '[]'::jsonb)
  );
$$;
grant execute on function rpc_sitemap_part(integer, integer) to anon, authenticated;
select sc_sitemap_refresh();
select cron.unschedule(jobid) from cron.job where jobname = 'sitemap-refresh';
select cron.schedule('sitemap-refresh', '29 3 * * *', 'select sc_sitemap_refresh()');

-- ---------------------------------------------------------------------------
-- Control room health: the song counts read all songs nine times; now once.
-- ---------------------------------------------------------------------------
create or replace function admin_health()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  result jsonb;
  c record;
begin
  if not is_admin() then raise exception 'not authorized'; end if;

  select count(*) filter (where parent_track_id is null) as songs,
         count(*) filter (where parent_track_id is not null) as versions,
         count(*) filter (where release_status = 'released') as released,
         count(*) filter (where release_status = 'leaked') as leaked,
         count(*) filter (where release_status = 'unconfirmed') as unconfirmed,
         count(*) filter (where spotify_url is not null) as with_link,
         count(*) filter (where created_at > now() - interval '7 days') as added_7,
         count(*) filter (where spotify_search_attempted_at is not null) as sp_checked,
         count(*) filter (where spotify_url is null and spotify_search_attempted_at is null) as sp_left
  into c from tracks;

  select jsonb_build_object(
    'generated_at', now(),
    'catalogue', jsonb_build_object(
      'artists', (select count(*) from artists),
      'songs', c.songs,
      'versions', c.versions,
      'released', c.released,
      'leaked', c.leaked,
      'unconfirmed', c.unconfirmed,
      'with_link', c.with_link,
      'added_last_7_days', c.added_7
    ),
    'reviews', jsonb_build_object(
      'submissions', (select count(*) from submissions where status = 'pending'),
      'discoveries', (select count(*) from discoveries where state = 'open'),
      'sub_versions', (select count(*) from version_suggestions where state = 'open'),
      'imported_songs', (select count(*) from import_suggestions where state = 'open'),
      'takedowns', (select count(*) from takedown_requests where state = 'open'),
      'oldest_takedown', (select min(created_at) from takedown_requests where state = 'open')
    ),
    'spotify_matching', jsonb_build_object(
      'checked', c.sp_checked,
      'left', c.sp_left,
      'last_checked_at', (select max(spotify_search_attempted_at) from tracks),
      'checked_last_hour', (select count(*) from tracks where spotify_search_attempted_at > now() - interval '1 hour')
    ),
    'queue', jsonb_build_object(
      'due', (select count(*) from sc_artist_queue(5000, true)),
      'next', (select coalesce(jsonb_agg(jsonb_build_object('artist_id', q.artist_id, 'name', q.name, 'why', q.reasons)), '[]'::jsonb)
               from sc_artist_queue(5, true) q)
    ),
    'routine_runs', (
      select coalesce(jsonb_agg(x order by x->>'started_at' desc), '[]'::jsonb) from (
        select jsonb_build_object('started_at', r.started_at, 'who', coalesce(p.display_name, 'someone'),
          'artists', r.artists_checked, 'findings', r.findings, 'submitted', r.submitted, 'summary', r.summary) x
        from routine_runs r left join profiles p on p.id = r.user_id
        where coalesce(r.summary, '') <> 'test_connection'
        order by r.started_at desc limit 10) s),
    'routine_users_last_7_days', (select count(distinct user_id) from routine_runs where started_at > now() - interval '7 days'),
    'imports', (
      select coalesce(jsonb_agg(x order by x->>'started_at' desc), '[]'::jsonb) from (
        select jsonb_build_object('started_at', i.started_at, 'artist', a.name, 'artist_id', i.artist_id,
          'source', i.source, 'who', coalesce(p.display_name, 'someone'), 'added', i.added, 'updated', i.updated,
          'suggested', i.suggested, 'skipped', i.skipped, 'error', i.error,
          'running', i.finished_at is null) x
        from import_runs i join artists a on a.id = i.artist_id left join profiles p on p.id = i.requested_by
        order by i.started_at desc limit 15) s),
    'problems', (
      select coalesce(jsonb_agg(x order by x->>'at' desc), '[]'::jsonb) from (
        select jsonb_build_object('at', i.started_at, 'what', initcap(i.source) || ' import for ' || a.name,
          'error', i.error,
          'rate_limited', i.error ilike '%slow down%') x
        from import_runs i join artists a on a.id = i.artist_id
        where i.error is not null and i.started_at > now() - interval '7 days'
        union all
        select jsonb_build_object('at', i.started_at, 'what', initcap(i.source) || ' import for ' || a.name,
          'error', 'Still running after 10 minutes; it probably timed out.', 'rate_limited', false)
        from import_runs i join artists a on a.id = i.artist_id
        where i.finished_at is null and i.started_at < now() - interval '10 minutes'
          and i.started_at > now() - interval '7 days'
      ) s),
    'batches', (
      select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb) from (
        select jsonb_build_object('created_at', b.created_at, 'label', coalesce(b.label, b.kind), 'kind', b.kind,
          'undone', b.undone_at is not null,
          'changes', (select count(*) from change_log l where l.batch_id = b.id)) x
        from change_batches b order by b.created_at desc limit 8) s)
  ) into result;
  return result;
end;
$$;
