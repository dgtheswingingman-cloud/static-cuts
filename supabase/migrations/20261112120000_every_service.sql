-- Every service checks every song.
-- 1. Spotify: releases are read 20 at a time (one call), not one per call.
-- 2. song_checks: which service last looked at which song. The song-check job
--    goes through every song for Deezer and Apple, whatever links it already
--    has, and fills in only what's empty (link, ISRC, length, album, date,
--    cover, explicit, genre); an official match also marks an unconfirmed
--    song released (quietly).

-- 1. Up to 20 unread Spotify releases (liked-song releases first, then the
--    artists the site weighs most).
create or replace function sc_spotify_albums_batch(p_limit int default 20) returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_agg(jsonb_build_object('artist_id', x.artist_id, 'spotify_artist_id', x.spotify_artist_id, 'album_id', x.album_id)), '[]')
  from (
    select s.artist_id, a.spotify_artist_id, s.album_id
    from spotify_albums s join artists a on a.id = s.artist_id left join sc_artist_weights() w on w.artist_id = a.id
    where s.fetched_at is null and a.spotify_artist_id ~ '^[A-Za-z0-9]{22}$'
      and (not a.catalogue_hold or exists (select 1 from import_runs r where r.artist_id = a.id and r.source = 'spotify' and r.finished_at is null))
    order by exists (select 1 from spotify_liked_pending p where p.artist_id = s.artist_id and p.album_id = s.album_id) desc,
             exists (select 1 from launch_artists l where l.artist_id = a.id) desc,
             coalesce(w.weight, 0) desc, a.id, case s.grp when 'album' then 0 when 'single' then 1 else 2 end, s.album_id
    limit greatest(1, least(p_limit, 20))) x;
$$;
revoke execute on function sc_spotify_albums_batch(int) from public, anon, authenticated;

-- 2. Per-service song checks.
create table if not exists song_checks (
  track_id text not null references tracks(id) on delete cascade,
  service text not null,
  checked_at timestamptz not null default now(),
  found text,
  primary key (track_id, service)
);
alter table song_checks enable row level security;
create index if not exists song_checks_service_time on song_checks (service, checked_at);

-- Songs this service hasn't looked at in 90 days: launch artists first,
-- then released songs, then songs missing the most it can fill.
create or replace function sc_song_check_next(p_secret text, p_service text, p_limit int default 25) returns jsonb
language plpgsql security definer set search_path to 'public' set statement_timeout to '30s' as $$
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then raise exception 'not authorized'; end if;
  if p_service not in ('deezer', 'apple') then raise exception 'unknown service'; end if;
  return coalesce((select jsonb_agg(x) from (
    select t.id, t.title, a.name artist, t.release_status status, t.isrc, t.length_sec, t.deezer_url, t.apple_url,
           t.album, t.release_date, (t.cover_url is null and t.fan_cover_url is null) no_cover
    from tracks t join artists a on a.id = t.artist_id
    where t.parent_track_id is null and t.release_status in ('released', 'unconfirmed')
      and not exists (select 1 from song_checks c where c.track_id = t.id and c.service = p_service and c.checked_at > now() - interval '90 days')
      and (p_service <> 'deezer' or t.deezer_url is null or t.isrc is null or t.length_sec is null or t.album is null or t.release_date is null or t.cover_url is null)
      and (p_service <> 'apple' or t.apple_url is null or t.genre is null or t.release_date is null)
    order by exists (select 1 from launch_artists l where l.artist_id = t.artist_id) desc,
             (t.release_status = 'released') desc,
             (case when p_service = 'deezer' then (t.deezer_url is null)::int + (t.isrc is null)::int + (t.album is null)::int + (t.release_date is null)::int
                   else (t.apple_url is null)::int + (t.release_date is null)::int end) desc,
             t.id
    limit greatest(1, least(p_limit, 50))) x), '[]');
end $$;

create or replace function sc_song_check_save(p_secret text, p_service text, p_items jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare n int; r int;
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then raise exception 'not authorized'; end if;
  insert into song_checks (track_id, service, found)
  select x ->> 'track_id', p_service, x ->> 'found' from jsonb_array_elements(p_items) x
  where exists (select 1 from tracks t where t.id = x ->> 'track_id')
  on conflict (track_id, service) do update set checked_at = now(), found = excluded.found;
  perform set_config('static_cuts.skip_status_log', 'on', true);
  update tracks t set
    release_status = case when t.release_status = 'unconfirmed' and x ->> 'found' is not null and x ->> 'found' <> 'none' then 'released' else t.release_status end,
    deezer_url = coalesce(t.deezer_url, case when x ->> 'deezer_id' ~ '^\d+$' then 'https://www.deezer.com/track/' || (x ->> 'deezer_id') end),
    apple_url = coalesce(t.apple_url, case when x ->> 'apple_url' ~ '^https://music\.apple\.com/' then x ->> 'apple_url' end),
    isrc = coalesce(t.isrc, case when x ->> 'isrc' ~ '^[A-Z]{2}[A-Z0-9]{3}\d{7}$' then x ->> 'isrc' end),
    length_sec = coalesce(t.length_sec, case when x ->> 'length_sec' ~ '^\d{1,5}$' and (x ->> 'length_sec')::int between 1 and 36000 then (x ->> 'length_sec')::int end),
    album = coalesce(nullif(trim(t.album), ''), nullif(left(trim(x ->> 'album'), 200), '')),
    release_date = coalesce(t.release_date, case when x ->> 'release_date' ~ '^\d{4}-\d{2}-\d{2}$' and (x ->> 'release_date')::date <= current_date + 365 then (x ->> 'release_date')::date end),
    cover_url = coalesce(t.cover_url, case when x ->> 'cover' ~ '^https://' then x ->> 'cover' end),
    explicit = coalesce(t.explicit, (x ->> 'explicit')::boolean),
    genre = coalesce(t.genre, nullif(left(x ->> 'genre', 60), ''))
  from jsonb_array_elements(p_items) x
  where t.id = x ->> 'track_id' and x ->> 'found' is not null and x ->> 'found' <> 'none';
  get diagnostics n = row_count;
  perform set_config('static_cuts.skip_status_log', '', true);
  return jsonb_build_object('updated', n);
end $$;
revoke execute on function sc_song_check_next(text, text, int), sc_song_check_save(text, text, jsonb) from public, anon, authenticated;

-- Their own allowances (Deezer is generous; Apple shares the iTunes one).
insert into sc_private_settings (key, value) values ('deezersong_per_minute', '60'), ('deezersong_per_day', '60000')
on conflict (key) do nothing;

-- Timers: Deezer every 2 minutes, Apple every 3 (it shares Apple's allowance).
select cron.schedule('song-check-deezer', '*/2 * * * *', $c$
  select net.http_post(url := 'https://pcuyzaamcsegblrauxsa.supabase.co/functions/v1/run-job',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select value from public.sc_private_settings where key = 'cron_secret')),
    body := '{"fn":"song-check","body":{"service":"deezer","source":"deezer"}}'::jsonb, timeout_milliseconds := 5000);
$c$);
select cron.schedule('song-check-apple', '1-59/3 * * * *', $c$
  select net.http_post(url := 'https://pcuyzaamcsegblrauxsa.supabase.co/functions/v1/run-job',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select value from public.sc_private_settings where key = 'cron_secret')),
    body := '{"fn":"song-check","body":{"service":"apple","source":"apple"}}'::jsonb, timeout_milliseconds := 5000);
$c$);
