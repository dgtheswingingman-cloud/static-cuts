-- 26 Nov.
-- 1. YouTube search (about 60-100 a day on the default quota) puts the main
--    (launch) artists first. Their released songs can now be found free on
--    Spotify (20261126134500), so YouTube goes to their leaks and snippets
--    first, then released or unconfirmed songs Spotify already tried and couldn't
--    find,
--    then everyone else by weight. (Records the 25 Nov live change to put
--    launch artists first, and refines it.)
-- 2. Progress cards: a Deezer or Apple Music link counts as a listen link
--    too, not only the main link.

create or replace function public.sc_youtube_next(p_secret text, p_limit integer default 1)
returns table(track_id text, title text, artist text, release_status text)
language plpgsql security definer set search_path to 'public'
as $function$
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then
    raise exception 'not authorized';
  end if;
  return query
  with w as (select * from sc_artist_weights() where weight > 0)
  select t.id, t.title, a.name, t.release_status
  from tracks t join artists a on a.id = t.artist_id join w on w.artist_id = t.artist_id
  where t.spotify_url is null and t.parent_track_id is null and not t.has_file
    and not exists (select 1 from track_link_candidates c where c.track_id = t.id)
    and not exists (select 1 from youtube_searches y where y.track_id = t.id and y.searched_at > now() - interval '90 days')
  order by
    case when exists (select 1 from launch_artists l where l.artist_id = t.artist_id) then
           case when t.release_status in ('leaked', 'snippet') then 0
                when coalesce(t.release_status, 'unconfirmed') in ('released', 'unconfirmed') and t.spotify_search_attempted_at is not null then 1
                else 3 end
         else 2 end,
    w.weight desc, (t.release_status in ('released', 'leaked', 'snippet')) desc, t.id
  limit greatest(1, least(coalesce(p_limit, 1), 5));
end;
$function$;

create or replace function public.sc_launch_progress_now()
returns table (artist_id text, data jsonb)
language sql stable security definer set search_path = public as $$
  select l.artist_id, jsonb_build_object(
    'songs', count(t.id),
    'status', count(t.id) filter (where coalesce(t.release_status, 'unconfirmed') <> 'unconfirmed'),
    'link_of', count(t.id) filter (where t.release_status in ('released', 'leaked', 'snippet')),
    'link', count(t.id) filter (where t.release_status in ('released', 'leaked', 'snippet')
                                  and coalesce(t.spotify_url, t.deezer_url, t.apple_url) is not null),
    'date_of', count(t.id) filter (where t.release_status = 'leaked'),
    'date', count(t.id) filter (where t.release_status = 'leaked' and t.leak_date is not null),
    'era_of', count(t.id) filter (where coalesce(t.release_status, 'unconfirmed') <> 'released'),
    'era', count(t.id) filter (where coalesce(t.release_status, 'unconfirmed') <> 'released' and nullif(t.album, '') is not null))
  from launch_artists l left join tracks t on t.artist_id = l.artist_id and t.parent_track_id is null
  group by l.artist_id
$$;
