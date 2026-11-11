-- More cover art.
--  1. Songs with no cover: from albums the site already knows (Deezer
--     tracklists, an official album with the same name), then a timer job
--     (cover-search) that asks Deezer/Apple for songs with a link, and
--     searches Deezer for an exact artist + title match for the rest.
--  2. Era art: unreleased songs tagged with an official album era show that
--     album's cover (marked as era art, not the song's own).

-- ---- 1a. from what we already have
create or replace function public.sc_cover_fill_known() returns int
language plpgsql security definer set search_path to 'public' set statement_timeout to '300s' as $$
declare a int; b int;
begin
  -- on a Deezer album's tracklist
  with hit as (
    select distinct on (t.id) t.id, d.cover from tracks t
    join album_tracks at on at.track_id = t.id join deezer_albums d on d.album_id = at.album_id
    where t.cover_url is null and t.parent_track_id is null and d.cover is not null
    order by t.id, (d.kind = 'album') desc, d.release_date)
  update tracks t set cover_url = hit.cover from hit where t.id = hit.id and t.cover_url is null;
  get diagnostics a = row_count;
  -- released songs whose album is one of the artist's official albums
  with ec as (
    select distinct on (artist_id, sc_album_base(title)) artist_id, sc_album_base(title) k, cover from deezer_albums
    where cover is not null order by artist_id, sc_album_base(title), (kind = 'album') desc, release_date),
  hit as (
    select t.id, ec.cover from tracks t join ec on ec.artist_id = t.artist_id and ec.k = sc_album_base(t.album)
    where t.cover_url is null and t.parent_track_id is null and t.release_status = 'released' and nullif(trim(t.album), '') is not null)
  update tracks t set cover_url = hit.cover from hit where t.id = hit.id and t.cover_url is null;
  get diagnostics b = row_count;
  return a + b;
end $$;

-- ---- 1b. the lookup queue
create table if not exists public.cover_search_checked (
  track_id text primary key references public.tracks(id) on delete cascade,
  checked_at timestamptz not null default now(),
  found text
);
alter table public.cover_search_checked enable row level security;
insert into public.sc_private_settings (key, value) values ('deezercover_per_minute', '45'), ('deezercover_per_day', '25000')
on conflict (key) do nothing;

create or replace function public.sc_cover_search_next(p_secret text, p_limit int default 30)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then raise exception 'not authorized'; end if;
  return coalesce((select jsonb_agg(x) from (
    select t.id, t.title, a.name artist, t.deezer_url, t.apple_url from tracks t join artists a on a.id = t.artist_id
    where t.parent_track_id is null and t.cover_url is null and t.release_status in ('released', 'unconfirmed')
      and not exists (select 1 from cover_search_checked c where c.track_id = t.id and c.checked_at > now() - interval '90 days')
    -- released first, then songs from artists people follow, then the rest
    order by (t.release_status = 'released') desc, (t.deezer_url is not null or t.apple_url is not null) desc,
      (select count(*) from follows f where f.artist_id = t.artist_id) desc, t.id
    limit greatest(1, least(p_limit, 60))) x), '[]');
end $$;

create or replace function public.sc_cover_search_save(p_secret text, p_items jsonb) returns int
language plpgsql security definer set search_path to 'public' as $$
declare n int;
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then raise exception 'not authorized'; end if;
  insert into cover_search_checked (track_id, found)
  select x ->> 'track_id', x ->> 'how' from jsonb_array_elements(p_items) x
  on conflict (track_id) do update set checked_at = now(), found = excluded.found;
  update tracks t set cover_url = x ->> 'cover_url', cover_checked_at = now()
  from jsonb_array_elements(p_items) x
  where t.id = x ->> 'track_id' and t.cover_url is null and x ->> 'cover_url' ~ '^https://';
  get diagnostics n = row_count;
  return n;
end $$;

-- ---- 2. era art
create table if not exists public.era_covers (
  artist_id text not null,
  album_key text not null,
  url text not null,
  primary key (artist_id, album_key)
);
alter table public.era_covers enable row level security;

create or replace function public.sc_era_covers_refresh() returns int
language plpgsql security definer set search_path to 'public' set statement_timeout to '300s' as $$
declare n int;
begin
  delete from era_covers;
  insert into era_covers (artist_id, album_key, url)
  select distinct on (artist_id, sc_album_base(title)) artist_id, sc_album_base(title), cover from deezer_albums
  where cover is not null and nullif(sc_album_base(title), '') is not null
  order by artist_id, sc_album_base(title), (kind = 'album') desc, release_date;
  get diagnostics n = row_count;
  return n;
end $$;

-- The picture each song shows: own art, the fans' pick, its era's album
-- cover (unreleased songs tagged with an official album), else a photo of
-- the artist.
create or replace function public.sc_track_cover(p_track text) returns jsonb
language sql stable security definer set search_path to 'public' as $$
  with t as (select id, artist_id, cover_url, fan_cover_url, album from tracks where id = p_track),
  ph as (
    select p.url, row_number() over (order by p.created_at, p.id) - 1 n, count(*) over () c
    from artist_photos p join t on p.artist_id = t.artist_id where not p.removed)
  select case
    when t.cover_url is not null then jsonb_build_object('url', t.cover_url, 'kind', 'own')
    when t.fan_cover_url is not null then jsonb_build_object('url', t.fan_cover_url, 'kind', 'fan')
    when nullif(trim(t.album), '') is not null and (select e.url from era_covers e where e.artist_id = t.artist_id and e.album_key = sc_album_base(t.album)) is not null
      then jsonb_build_object('url', (select e.url from era_covers e where e.artist_id = t.artist_id and e.album_key = sc_album_base(t.album)), 'kind', 'era')
    else (select jsonb_build_object('url', ph.url, 'kind', 'artist') from ph
          where ph.n = abs(hashtext(t.id)) % greatest(ph.c, 1) limit 1)
  end
  from t;
$$;

revoke execute on function public.sc_cover_fill_known(), public.sc_cover_search_next(text, int), public.sc_cover_search_save(text, jsonb),
  public.sc_era_covers_refresh() from anon, authenticated, public;

select cron.schedule('covers-known', '41 3 * * *', $$ select public.sc_cover_fill_known(); select public.sc_era_covers_refresh(); $$);
select cron.schedule('cover-search', '*/2 * * * *', $c$
  select net.http_post(
    url := 'https://pcuyzaamcsegblrauxsa.supabase.co/functions/v1/run-job',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select value from public.sc_private_settings where key = 'cron_secret')),
    body := jsonb_build_object('fn', 'cover-search', 'body', jsonb_build_object()),
    timeout_milliseconds := 15000);
$c$);

-- Make the covers we can match straight away now.
select public.sc_cover_fill_known();
select public.sc_era_covers_refresh();
