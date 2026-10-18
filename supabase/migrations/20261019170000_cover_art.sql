-- Cover art.
--
-- Songs with a Spotify link get their artwork from Spotify's public embed
-- info (open.spotify.com/oembed: no API key, separate from the matching
-- that got rate-limited). A timer calls the fetch-covers function every 10
-- minutes; each run does up to 20 songs, two seconds apart, and stops if
-- Spotify asks it to slow down. Songs on the same album share the artwork.
--
-- Turn off:  select cron.unschedule('fetch-covers');

alter table tracks add column if not exists cover_url text;
alter table tracks add column if not exists cover_checked_at timestamptz;

-- Next songs to look up (called by fetch-covers with the timer's password).
create or replace function sc_cover_next(p_secret text, p_limit int default 20)
returns table (track_id text, spotify_url text)
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then
    raise exception 'not authorized';
  end if;
  return query
  select t.id, t.spotify_url from tracks t
  where t.spotify_url ~ '^https://open\.spotify\.com/(track|album)/'
    and t.cover_url is null
    and (t.cover_checked_at is null or t.cover_checked_at < now() - interval '30 days')
  order by (select count(*) from follows f where f.artist_id = t.artist_id) desc, t.created_at desc nulls last
  limit greatest(1, least(coalesce(p_limit, 20), 50));
end;
$$;

-- Save what was found ([{track_id, cover_url}], cover_url null = none).
-- Other songs on the same album without artwork get it too.
create or replace function sc_cover_save(p_secret text, p_items jsonb)
returns int
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  it jsonb;
  n int := 0;
  t tracks%rowtype;
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then
    raise exception 'not authorized';
  end if;
  perform set_config('static_cuts.skip_status_log', 'on', true);
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    update tracks set cover_checked_at = now(),
                      cover_url = coalesce(nullif(it ->> 'cover_url', ''), cover_url)
    where id = it ->> 'track_id'
    returning * into t;
    if t.id is not null and t.cover_url is not null then
      n := n + 1;
      if t.album is not null then
        update tracks set cover_url = t.cover_url
        where artist_id = t.artist_id and album = t.album and cover_url is null;
      end if;
    end if;
  end loop;
  return n;
end;
$$;

-- Song pages include the artwork.
do $$
declare
  d text;
begin
  select pg_get_functiondef('public.rpc_song_page(text)'::regprocedure) into d;
  if d not like '%''cover_url''%' then
    d := replace(d, $x$'release_date', t.release_date,$x$, $x$'release_date', t.release_date, 'cover_url', t.cover_url,$x$);
    if d not like '%''cover_url''%' then raise exception 'could not update rpc_song_page'; end if;
    execute d;
  end if;
end $$;

-- The radar and lists show it too.
do $$
declare
  d text;
begin
  select pg_get_functiondef('public.rpc_list_page(uuid)'::regprocedure) into d;
  if d not like '%''cover_url''%' then
    d := replace(d, $x$'spotify_url', t.spotify_url, 'album', t.album)$x$, $x$'spotify_url', t.spotify_url, 'album', t.album, 'cover_url', t.cover_url)$x$);
    if d not like '%''cover_url''%' then raise exception 'could not update rpc_list_page'; end if;
    execute d;
  end if;
end $$;

drop function if exists rpc_release_radar();
create or replace function rpc_release_radar()
returns table (section text, track_id text, title text, artist_id text, artist text, album text,
               release_date date, status text, spotify_url text, watchers bigint, watching boolean, cover_url text)
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
  )
  select p.section, p.id, p.title, p.artist_id, a.name, p.album, p.release_date, p.release_status, p.spotify_url,
         (select count(*) from radar_watches w where w.track_id = p.id),
         exists (select 1 from radar_watches w where w.track_id = p.id and w.user_id = auth.uid()),
         p.cover_url
  from picked p join artists a on a.id = p.artist_id
  order by case p.section when 'upcoming' then 0 when 'tba' then 1 else 2 end,
           case when p.section = 'dropped' then null else p.release_date end nulls last,
           p.release_date desc nulls last, a.name, p.album nulls last, p.track_number nulls last, p.title
  limit 500;
$$;
grant execute on function rpc_release_radar() to anon, authenticated;

revoke execute on function sc_cover_next(text, int), sc_cover_save(text, jsonb) from public, anon, authenticated;
grant execute on function sc_cover_next(text, int), sc_cover_save(text, jsonb) to service_role;

select cron.unschedule('fetch-covers') where exists (select 1 from cron.job where jobname = 'fetch-covers');
select cron.schedule('fetch-covers', '3-59/10 * * * *', $job$
  select net.http_post(
    url := 'https://pcuyzaamcsegblrauxsa.supabase.co/functions/v1/fetch-covers',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select value from public.sc_private_settings where key = 'cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000);
$job$);
