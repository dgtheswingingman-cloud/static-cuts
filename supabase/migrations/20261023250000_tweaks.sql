-- Tweaks:
--  1. Artists without a Spotify link get one looked up (artist-info timer,
--     4 a run): from one of their songs' Spotify links if they have one,
--     otherwise a Spotify search that's only accepted when exactly one
--     artist has that name. With a link, their releases get read like
--     everyone else's. Tried again after 60 days if nothing was found.
--  2. artist-info's timer waits 2 minutes (it does genres too now).
--  3. Genre scores are cached (refreshed every 10 minutes) instead of
--     worked out on every page load.

alter table artists add column if not exists spotify_lookup_at timestamptz;

create or replace function sc_spotify_lookup_next(p_secret text, p_limit int default 4)
returns table(artist_id text, name text, track_id text)
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then
    raise exception 'not authorized';
  end if;
  return query
  select a.id, a.name,
         (select substring(t.spotify_url from 'track/([A-Za-z0-9]{22})') from tracks t
          where t.artist_id = a.id and t.spotify_url ~ 'open\.spotify\.com/track/[A-Za-z0-9]{22}' limit 1)
  from artists a
  left join sc_artist_weights() w on w.artist_id = a.id
  left join artist_track_counts c on c.artist_id = a.id
  where a.spotify_artist_id is null
    and (a.spotify_lookup_at is null or a.spotify_lookup_at < now() - interval '60 days')
  order by coalesce(c.n, 0) = 0 desc, coalesce(w.weight, 0) desc, coalesce(c.n, 0) desc, a.id
  limit greatest(1, least(coalesce(p_limit, 4), 20));
end;
$$;
revoke execute on function sc_spotify_lookup_next(text, int) from public, anon, authenticated;

create or replace function sc_spotify_lookup_save(p_secret text, p_items jsonb)
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
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]')) loop
    update artists set spotify_lookup_at = now(),
      spotify_artist_id = case
        when it ->> 'spotify_artist_id' ~ '^[A-Za-z0-9]{22}$'
         and not exists (select 1 from artists o where o.spotify_artist_id = it ->> 'spotify_artist_id')
        then it ->> 'spotify_artist_id' else spotify_artist_id end
    where id = it ->> 'artist_id' and spotify_artist_id is null;
    if found and it ->> 'spotify_artist_id' is not null then n := n + 1; end if;
  end loop;
  return n;
end;
$$;
revoke execute on function sc_spotify_lookup_save(text, jsonb) from public, anon, authenticated;

select cron.schedule('artist-info', '23,53 * * * *', $cron$
  select net.http_post(
    url := 'https://pcuyzaamcsegblrauxsa.supabase.co/functions/v1/artist-info',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select value from public.sc_private_settings where key = 'cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000);
$cron$);

-- Genre scores, cached.
create table if not exists artist_genre_cache (
  artist_id text not null, slug text not null, tag text not null, score int not null,
  primary key (artist_id, slug)
);
create index if not exists artist_genre_cache_slug on artist_genre_cache (slug);
alter table artist_genre_cache enable row level security;
revoke all on artist_genre_cache from anon, authenticated;

create or replace function sc_artist_genres_live()
returns table(artist_id text, slug text, tag text, score int)
language sql
stable
security definer
set search_path to 'public'
as $$
  select t.artist_id, sc_genre_slug(t.tag), (array_agg(t.tag order by t.source nulls first, t.created_at))[1],
         (sum(coalesce(t.weight, 0)) + 3 * sum((select count(*) from artist_genre_tag_votes v where v.tag_id = t.id)))::int
  from artist_genre_tags t
  where sc_genre_slug(t.tag) <> ''
  group by t.artist_id, sc_genre_slug(t.tag);
$$;
revoke execute on function sc_artist_genres_live() from public, anon, authenticated;

create or replace function sc_refresh_genre_cache()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  delete from artist_genre_cache;
  insert into artist_genre_cache (artist_id, slug, tag, score)
  select artist_id, slug, tag, score from sc_artist_genres_live();
end;
$$;
revoke execute on function sc_refresh_genre_cache() from public, anon, authenticated;

create or replace function sc_artist_genres()
returns table(artist_id text, slug text, tag text, score int)
language sql
stable
security definer
set search_path to 'public'
as $$
  select artist_id, slug, tag, score from artist_genre_cache;
$$;

select sc_refresh_genre_cache();
select cron.schedule('genre-cache', '*/10 * * * *', 'select public.sc_refresh_genre_cache()');
