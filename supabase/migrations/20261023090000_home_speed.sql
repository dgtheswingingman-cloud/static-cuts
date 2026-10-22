-- Homepage speed. The homepage asks the database for the same things on
-- every visit, and three of them were slow (up to several seconds when
-- busy):
--   what's new (live feed)   ~0.8s: goes through 90 days of changes
--   release radar            ~0.5s
--   artist list with counts  ~0.2s each, counting every song every time
-- Now:
--   - what's new (the everyone-sees-the-same version) and the release radar
--     are kept for 2 minutes and shared by every visitor. Your own "remind
--     me" ticks on the radar are still live.
--   - song counts per artist are kept in a small table, updated every 10
--     minutes, instead of counting ~95,000 songs on every visit.
--   - an index so "songs added recently" doesn't read the whole table.

create index if not exists tracks_created_idx on tracks (created_at desc) where created_at is not null;

create table if not exists home_cache (
  key text primary key,
  data jsonb not null,
  refreshed_at timestamptz not null default now()
);
alter table home_cache enable row level security;
revoke all on home_cache from anon, authenticated;

-- ------------------------------------------------------------ what's new
alter function rpc_whats_new(date, text, boolean, integer) rename to sc_whats_new_live;
revoke execute on function sc_whats_new_live(date, text, boolean, integer) from public, anon, authenticated;

create or replace function rpc_whats_new(p_before date default null, p_kind text default 'all',
                                         p_following boolean default false, p_days integer default 3)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  v_key text;
  v_data jsonb;
begin
  -- Your own follows, or older pages: worked out each time.
  if p_before is not null or coalesce(p_following, false) then
    return sc_whats_new_live(p_before, p_kind, p_following, p_days);
  end if;
  v_key := 'whats_new:' || coalesce(p_kind, 'all') || ':' || coalesce(p_days, 3);
  select data into v_data from home_cache where key = v_key and refreshed_at > now() - interval '2 minutes';
  if v_data is not null then return v_data; end if;
  v_data := sc_whats_new_live(null, p_kind, false, p_days);
  insert into home_cache (key, data, refreshed_at) values (v_key, v_data, now())
  on conflict (key) do update set data = excluded.data, refreshed_at = excluded.refreshed_at;
  return v_data;
end;
$$;
grant execute on function rpc_whats_new(date, text, boolean, integer) to anon, authenticated;

-- --------------------------------------------------------- release radar
create or replace function sc_release_radar_live()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  with today as (select (now() at time zone 'Europe/London')::date d),
  picked as (
    select case
             when t.release_date >= today.d then 'upcoming'
             when t.release_status = 'announced' then 'tba'
             else 'dropped'
           end section, t.*
    from tracks t, today
    where t.parent_track_id is null and t.release_status <> 'removed'
      and (t.release_date >= today.d
           or (t.release_status = 'announced' and t.release_date is null)
           or (t.release_date between today.d - 14 and today.d - 1 and t.release_status in ('released', 'leaked'))
           or exists (select 1 from track_status_events e where e.track_id = t.id and e.from_status = 'announced'
                      and e.created_at > now() - interval '14 days'))
  ), rows as (
    select p.section, p.id track_id, p.title, p.artist_id, a.name artist, p.album, p.release_date, p.release_status status,
           p.spotify_url, (select count(*) from radar_watches w where w.track_id = p.id) watchers, p.cover_url,
           row_number() over (order by case p.section when 'upcoming' then 0 when 'tba' then 1 else 2 end,
             case when p.section = 'dropped' then null else p.release_date end nulls last,
             p.release_date desc nulls last, a.name, p.album nulls last, p.track_number nulls last, p.title) ord
    from picked p join artists a on a.id = p.artist_id
  )
  select coalesce(jsonb_agg(to_jsonb(rows) order by ord), '[]'::jsonb) from rows where ord <= 500;
$$;
revoke execute on function sc_release_radar_live() from public, anon, authenticated;

create or replace function rpc_release_radar()
returns table(section text, track_id text, title text, artist_id text, artist text, album text, release_date date,
              status text, spotify_url text, watchers bigint, watching boolean, cover_url text)
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  v_data jsonb;
begin
  select data into v_data from home_cache where key = 'radar' and refreshed_at > now() - interval '2 minutes';
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

-- ------------------------------------------------- song counts per artist
create table if not exists artist_track_counts (
  artist_id text primary key,
  n int not null,
  refreshed_at timestamptz not null default now()
);
alter table artist_track_counts enable row level security;
revoke all on artist_track_counts from anon, authenticated;

create or replace function sc_refresh_artist_counts()
returns int
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_n int;
begin
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
revoke execute on function sc_refresh_artist_counts() from public, anon, authenticated;
select sc_refresh_artist_counts();
select cron.schedule('artist-counts-refresh', '*/10 * * * *', $$ select public.sc_refresh_artist_counts(); $$);

create or replace function rpc_home_artists(p_mine boolean default true)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  with mine as (
    select t.artist_id, count(*) n
    from track_ownership o join tracks t on t.id = o.track_id
    where p_mine and auth.uid() is not null and o.user_id = auth.uid()
    group by t.artist_id
  ), nick as (
    select artist_id, array_agg(alias order by alias) aliases from artist_aliases group by artist_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'name', a.name, 'status', a.status,
    'track_count', coalesce(c.n, 0), 'collected', coalesce(m.n, 0),
    'avg_rating', r.avg_rating, 'rating_count', coalesce(r.rating_count, 0),
    'aliases', coalesce(k.aliases, '{}')
  ) order by a.name), '[]'::jsonb)
  from artists a
  left join artist_track_counts c on c.artist_id = a.id
  left join mine m on m.artist_id = a.id
  left join artist_rating_stats r on r.artist_id = a.id
  left join nick k on k.artist_id = a.id;
$$;
