-- Lighter background jobs. Most of the database's time was going on the
-- jobs, not on people using the site:
--
-- 1. Covers: picking the next songs searched the whole songs table every
--    call (3-13 s), even with nothing to do. A small index over songs that
--    have a Spotify link but no cover (a few hundred) makes it instant.
-- 2. Guest artists: picking the next guests re-read 30,000 song notes on
--    every call (1.5-13 s) to rank them. The ranking is now saved on the
--    guest list (host_weight) by the 20-minute refresh, which itself now
--    reads the notes once instead of three times.
-- 3. Saved copies (homepage feed every 5 min, artist song counts every 10,
--    possible duplicates hourly) are skipped when no songs have been added
--    or removed since the last run. They still refresh now and then
--    regardless (30 min / 2 h / 6 h), so status changes show up too.
-- 4. The quick-merge list (20261101010000_quick_merge_cache.sql) is
--    refreshed by the hourly duplicates job instead of its own job every
--    15 minutes.

-- ---------------------------------------------------------------------------
-- 1. Covers
-- ---------------------------------------------------------------------------
create index if not exists tracks_cover_todo_idx on tracks (cover_checked_at nulls first)
  where cover_url is null and spotify_url is not null;

create or replace function sc_cover_next(p_secret text, p_limit integer default 20)
returns table(track_id text, spotify_url text)
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then
    raise exception 'not authorized';
  end if;
  return query
  select t.id, t.spotify_url from tracks t left join sc_artist_weights() w on w.artist_id = t.artist_id
  where t.cover_url is null and t.spotify_url is not null
    and t.spotify_url ~ '^https://open\.spotify\.com/(track|album)/'
    and (t.cover_checked_at is null or t.cover_checked_at < now() - interval '30 days')
  order by coalesce(w.weight, 0) desc, t.created_at desc nulls last
  limit greatest(1, least(coalesce(p_limit, 20), 50));
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Guest artists
-- ---------------------------------------------------------------------------
alter table guest_artists add column if not exists host_weight integer not null default 0;
create index if not exists guest_artists_next_idx on guest_artists (host_weight desc, songs desc, name)
  where state = 'pending' and songs > 0;

create or replace function sc_guest_refresh()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  g record;
  n int := 0;
begin
  -- Read the "Feature on X's song." notes once: song counts, which guests
  -- are gone, and how much the artists they feature with matter.
  with f as materialized (
    select lower(nm) k, nm, artist_id
    from (select sc_guest_name(notes) nm, artist_id from tracks where notes like 'Feature on %') x
    where nm is not null and nm <> ''
  ),
  agg as (select k, min(nm) nm, count(*)::int n from f group by k),
  hw as (select f.k, max(w.weight)::int wt from f join sc_artist_weights() w on w.artist_id = f.artist_id group by f.k),
  up as (
    insert into guest_artists (name_key, name, songs, host_weight)
    select a.k, a.nm, a.n, coalesce(h.wt, 0) from agg a left join hw h on h.k = a.k
    on conflict (name_key) do update
      set songs = excluded.songs,
          host_weight = excluded.host_weight,
          updated_at = case when guest_artists.songs is distinct from excluded.songs then now() else guest_artists.updated_at end
      where guest_artists.songs is distinct from excluded.songs
         or guest_artists.host_weight is distinct from excluded.host_weight
    returning 1
  )
  update guest_artists ga set songs = 0
  where ga.songs > 0 and not exists (select 1 from agg where agg.k = ga.name_key);

  -- Guests whose name is an artist here, or one of their nicknames.
  update guest_artists ga set artist_id = m.id, state = 'linked', checked_at = now(), note = null
  from (
    select g2.name_key, coalesce(a.id, al.artist_id) as id
    from guest_artists g2
    left join (select id, sc_normalize_title(name) k from artists) a on a.k = sc_normalize_title(g2.name)
    left join artist_aliases al on al.alias_key = sc_normalize_title(g2.name)
    where g2.songs > 0 and g2.artist_id is null and g2.state in ('pending', 'review') and sc_normalize_title(g2.name) <> ''
  ) m
  where m.name_key = ga.name_key and m.id is not null;

  -- Move their songs over, a few guests per run.
  for g in select * from guest_artists where artist_id is not null and songs > 0 order by songs desc limit 40 loop
    perform set_config('static_cuts.batch_id', '', true);
    perform sc_begin_batch('guests', 'Songs moved to ' || g.name || '''s page');
    n := n + sc_guest_move(g.name_key, g.artist_id);
    update guest_artists set songs = 0 where name_key = g.name_key;
  end loop;
  return n;
end;
$$;

create or replace function sc_guest_next(p_secret text, p_limit integer default 8)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_wait boolean := sc_existing_work_left();
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then
    raise exception 'not authorized';
  end if;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  return jsonb_build_object(
    'known', (select coalesce(jsonb_object_agg(spotify_artist_id, id), '{}'::jsonb) from artists where spotify_artist_id is not null),
    'new_pages', not v_wait,
    'guests', (
      with top as (
        select g.* from guest_artists g
        where g.state = 'pending' and g.songs > 0
          -- Waiting for new pages: each guest is looked at once a week (in
          -- case they turn out to be an artist already here).
          and (not v_wait or g.checked_at is null or g.checked_at < now() - interval '7 days')
        order by g.host_weight desc, g.songs desc, g.name
        limit greatest(1, least(coalesce(p_limit, 8), 20))
      )
      select coalesce(jsonb_agg(jsonb_build_object('key', p.name_key, 'name', p.name,
               'titles', (select jsonb_agg(x.title) from (
                  select t.title from tracks t
                  where t.notes like 'Feature on %' and lower(sc_guest_name(t.notes)) = p.name_key
                  order by t.id limit 3) x))), '[]'::jsonb)
      from top p));
end;
$$;

-- Fill host_weight now.
select sc_guest_refresh();

-- ---------------------------------------------------------------------------
-- 3. Skip saved-copy refreshes when no songs were added or removed
-- ---------------------------------------------------------------------------
-- Songs added + removed so far (the database's own running count). Goes
-- down only if the database restarts, which also counts as a change.
create or replace function sc_tracks_change_mark()
returns bigint
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(n_tup_ins, 0) + coalesce(n_tup_del, 0) from pg_stat_user_tables where relid = 'public.tracks'::regclass;
$$;

-- True when job p_key should run: songs were added or removed since it last
-- ran, or it hasn't run for p_every. Records the run.
create or replace function sc_job_due(p_key text, p_every interval)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_mark bigint := sc_tracks_change_mark();
  v_last record;
begin
  select data, refreshed_at into v_last from home_cache where key = 'mark:' || p_key;
  if v_last.refreshed_at is not null and v_last.refreshed_at > now() - p_every
     and (v_last.data ->> 'mark')::bigint = v_mark then
    return false;
  end if;
  insert into home_cache (key, data, refreshed_at) values ('mark:' || p_key, jsonb_build_object('mark', v_mark), now())
  on conflict (key) do update set data = excluded.data, refreshed_at = excluded.refreshed_at;
  return true;
end;
$$;
revoke execute on function sc_tracks_change_mark(), sc_job_due(text, interval) from public, anon, authenticated;

-- Homepage feed (every 5 minutes): only when songs changed, or every 30.
create or replace function sc_home_cache_refresh()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  k text;
begin
  if not sc_job_due('home', interval '30 minutes') then return; end if;
  foreach k in array array['whats_new:all:2', 'whats_new:all:3'] loop
    insert into home_cache (key, data, refreshed_at)
    values (k, sc_whats_new_live(null, 'all', false, split_part(k, ':', 3)::int), now())
    on conflict (key) do update set data = excluded.data, refreshed_at = excluded.refreshed_at;
  end loop;
end;
$$;

-- Artist song counts (every 10 minutes): only when songs were added or
-- removed, or every 2 hours (catches songs moved between artists).
create or replace function sc_refresh_artist_counts()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_n int;
begin
  if not sc_job_due('artist_counts', interval '2 hours') then return 0; end if;
  insert into artist_track_counts (artist_id, n, refreshed_at)
  select artist_id, count(*), now() from tracks group by artist_id
  on conflict (artist_id) do update set n = excluded.n, refreshed_at = excluded.refreshed_at
  where artist_track_counts.n is distinct from excluded.n;
  get diagnostics v_n = row_count;
  update artist_track_counts c set n = 0
  where c.n <> 0 and not exists (select 1 from tracks t where t.artist_id = c.artist_id);
  return v_n;
end;
$$;

-- Possible duplicates (hourly, ~25 s): only when songs were added or
-- removed, or every 6 hours. The quick-merge list rides along.
do $$
declare
  d text := pg_get_functiondef('public.sc_refresh_duplicate_candidates()'::regprocedure);
begin
  if position('sc_job_due(' in d) = 0 then
    d := replace(d, E'begin\r\n  create temp table _dc', E'begin\r\n  if not sc_job_due(''duplicates'', interval ''6 hours'') then return -1; end if;\r\n  create temp table _dc');
    d := replace(d, E'begin\n  create temp table _dc', E'begin\n  if not sc_job_due(''duplicates'', interval ''6 hours'') then return -1; end if;\n  create temp table _dc');
    d := replace(d, E'  get diagnostics v_n = row_count;\r\n  return v_n;', E'  get diagnostics v_n = row_count;\r\n  if to_regproc(''public.sc_identical_duplicates_refresh'') is not null then perform sc_identical_duplicates_refresh(); end if;\r\n  return v_n;');
    d := replace(d, E'  get diagnostics v_n = row_count;\n  return v_n;', E'  get diagnostics v_n = row_count;\n  if to_regproc(''public.sc_identical_duplicates_refresh'') is not null then perform sc_identical_duplicates_refresh(); end if;\n  return v_n;');
    if position('sc_job_due(' in d) = 0 or position('sc_identical_duplicates_refresh' in d) = 0 then
      raise exception 'could not update sc_refresh_duplicate_candidates';
    end if;
    execute d;
  end if;
end $$;

-- 4. The quick-merge list now refreshes with the duplicates job.
select cron.unschedule(jobid) from cron.job where jobname = 'identical-duplicates';
