-- Producer credits (and other gaps) from Genius, a little at a time.
--
-- A timer calls the genius-credits function every 10 minutes. Each run takes
-- up to 15 songs (busiest artists first, main songs before versions), finds
-- each on Genius (by its Genius id if an import left one, otherwise by
-- searching title + artist and only accepting a confident match), and fills
-- in only what's empty: producers, featured artists, release date and
-- artwork. Nothing already on a song is overwritten. Songs Genius doesn't
-- know are tried again after 60 days.
--
-- Turn off: select cron.unschedule('genius-credits');

alter table tracks add column if not exists genius_song_id bigint;
alter table tracks add column if not exists genius_checked_at timestamptz;

-- Genius ids the Genius imports already found.
update tracks t set genius_song_id = (s.extra ->> 'genius_id')::bigint
from import_suggestions s
where t.genius_song_id is null and t.source = 'genius' and s.source = 'genius'
  and s.url = t.source_url and (s.extra ->> 'genius_id') ~ '^\d+$';

create or replace function sc_genius_credit_next(p_secret text, p_limit int default 15)
returns table (track_id text, title text, artist text, genius_artist_id text, genius_song_id bigint)
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then
    raise exception 'not authorized';
  end if;
  return query
  select t.id, t.title, a.name, a.genius_artist_id, t.genius_song_id
  from tracks t join artists a on a.id = t.artist_id
  where (t.genius_checked_at is null or t.genius_checked_at < now() - interval '60 days')
    and (t.producers is null or t.featured_artists is null or t.cover_url is null)
  order by (t.genius_song_id is null), (select count(*) from follows f where f.artist_id = t.artist_id) desc,
           (t.parent_track_id is not null), (t.release_status in ('released', 'leaked')) desc, t.id
  limit greatest(1, least(coalesce(p_limit, 15), 40));
end;
$$;

-- Save results: [{track_id, genius_song_id, producers, featuring, release_date, cover_url}].
create or replace function sc_genius_credit_save(p_secret text, p_items jsonb)
returns int
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  it jsonb;
  n int := 0;
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then
    raise exception 'not authorized';
  end if;
  perform set_config('static_cuts.skip_status_log', 'on', true);
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    update tracks set
      genius_checked_at = now(),
      genius_song_id = coalesce(genius_song_id, nullif(it ->> 'genius_song_id', '')::bigint),
      producers = coalesce(producers, nullif(it ->> 'producers', '')),
      featured_artists = coalesce(nullif(featured_artists, ''), nullif(it ->> 'featuring', '')),
      release_date = case when release_date is null and release_status = 'released'
                          then nullif(it ->> 'release_date', '')::date else release_date end,
      cover_url = coalesce(cover_url, nullif(it ->> 'cover_url', ''))
    where id = it ->> 'track_id';
    if nullif(it ->> 'genius_song_id', '') is not null then n := n + 1; end if;
  end loop;
  return n;
end;
$$;

revoke execute on function sc_genius_credit_next(text, int), sc_genius_credit_save(text, jsonb) from public, anon, authenticated;
grant execute on function sc_genius_credit_next(text, int), sc_genius_credit_save(text, jsonb) to service_role;

select cron.unschedule('genius-credits') where exists (select 1 from cron.job where jobname = 'genius-credits');
select cron.schedule('genius-credits', '6-59/10 * * * *', $job$
  select net.http_post(
    url := 'https://pcuyzaamcsegblrauxsa.supabase.co/functions/v1/genius-credits',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select value from public.sc_private_settings where key = 'cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000);
$job$);

-- ---------------------------------------------------------------------------
-- Producer pages
-- ---------------------------------------------------------------------------

-- Every producer named on songs, with how many songs and artists.
create or replace function rpc_producers(p_query text default null, p_limit int default 200)
returns table (name text, songs bigint, artists bigint)
language sql
stable
security definer
set search_path to 'public'
as $$
  select min(n) name, count(distinct t.id), count(distinct t.artist_id)
  from tracks t, sc_split_names(t.producers) n
  where t.producers is not null
    and (p_query is null or n ilike '%' || p_query || '%')
  group by lower(n)
  order by count(distinct t.id) desc, min(n)
  limit greatest(1, least(coalesce(p_limit, 200), 1000));
$$;

-- One producer's songs.
create or replace function rpc_producer(p_name text)
returns table (track_id text, title text, artist_id text, artist text, status text, release_date date,
               album text, spotify_url text, cover_url text, co_producers text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select t.id, t.title, t.artist_id, a.name,
         coalesce(t.release_status, case when t.is_official then 'released' else 'unconfirmed' end),
         t.release_date, t.album, t.spotify_url, t.cover_url,
         (select string_agg(x, ', ') from sc_split_names(t.producers) x where lower(x) <> lower(p_name))
  from tracks t join artists a on a.id = t.artist_id
  where t.producers is not null
    and exists (select 1 from sc_split_names(t.producers) x where lower(x) = lower(trim(p_name)))
  order by t.release_date desc nulls last, a.name, t.title
  limit 1000;
$$;

revoke execute on function rpc_producers(text, int), rpc_producer(text) from public;
grant execute on function rpc_producers(text, int), rpc_producer(text) to anon, authenticated;
