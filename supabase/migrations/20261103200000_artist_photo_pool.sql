-- More artist photos (for song covers that fall back to an artist photo,
-- profile headers and cards): a job goes through artists, most-followed
-- first, and adds to their photo pool (artist_photos):
--   Deezer: their picture (big)
--   TheAudioDB (free public key): thumb, wide thumb and up to 4 fanart shots
--     only when it's clearly the same artist: same MusicBrainz ID, or exactly
--     one result with exactly their name (the Hi-C lesson)
-- Artists with no photo at all get the first one as their main photo.
-- Mods can remove any photo from the artist page.

insert into sc_private_settings (key, value) values ('audiodb_per_minute', '25'), ('audiodb_per_day', '20000')
on conflict (key) do nothing;

alter table artists add column if not exists photos_checked_at timestamptz;
alter table artists add column if not exists photos_claim_at timestamptz;

create or replace function sc_artist_photos_next(p_secret text, p_limit int default 12)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v jsonb;
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then raise exception 'not authorized'; end if;
  with pick as (
    select a.id from artists a
    where (a.photos_checked_at is null or a.photos_checked_at < now() - interval '60 days')
      and (a.photos_claim_at is null or a.photos_claim_at < now() - interval '10 minutes')
    order by a.photos_checked_at nulls first,
      (select count(*) from follows f where f.artist_id = a.id) desc,
      coalesce((select c.n from artist_track_counts c where c.artist_id = a.id), 0) desc
    limit greatest(1, least(coalesce(p_limit, 12), 30))
    for update of a skip locked
  ), claimed as (
    update artists a set photos_claim_at = now() from pick where a.id = pick.id returning a.id, a.name, a.deezer_artist_id, a.musicbrainz_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('artist_id', id, 'name', name, 'deezer_id', deezer_artist_id, 'mbid', musicbrainz_id)), '[]'::jsonb) into v from claimed;
  return v;
end;
$$;
revoke execute on function sc_artist_photos_next(text, int) from public, anon, authenticated;

create or replace function sc_artist_photos_save(p_secret text, p_artist text, p_urls text[])
returns int
language plpgsql
security definer
set search_path to 'public'
as $$
declare n int;
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then raise exception 'not authorized'; end if;
  insert into artist_photos (artist_id, url)
  select p_artist, u from unnest(coalesce(p_urls, '{}')) u
  where u ~ '^https://' and length(u) < 600
  on conflict (artist_id, url) do nothing;
  get diagnostics n = row_count;
  update artists set image_url = coalesce(image_url, (select u from unnest(coalesce(p_urls, '{}')) u where u ~ '^https://' limit 1)),
    photos_checked_at = now(), photos_claim_at = null
  where id = p_artist;
  return n;
end;
$$;
revoke execute on function sc_artist_photos_save(text, text, text[]) from public, anon, authenticated;

-- Every 3 minutes while there are artists to go through.
select cron.schedule('artist-photos', '1-59/3 * * * *', $cmd$
  select net.http_post(
    url := 'https://pcuyzaamcsegblrauxsa.supabase.co/functions/v1/run-job',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select value from public.sc_private_settings where key = 'cron_secret')),
    body := jsonb_build_object('fn', 'artist-photos', 'body', '{}'::jsonb),
    timeout_milliseconds := 15000)
  where exists (select 1 from public.artists a where a.photos_checked_at is null or a.photos_checked_at < now() - interval '60 days');
$cmd$);
