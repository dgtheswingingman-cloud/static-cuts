-- 26 Nov: 502 of the main (launch) artists' released songs had no listen
-- link, and Spotify had never been searched for almost all of them (e.g.
-- Carti's "YSL", "R.I.P. Fredo"). The song-by-song search only ran for
-- artists without a Spotify profile; artists with one rely on their album
-- track lists, which miss songs whose title differs a little. Now the main
-- artists' main songs that were never searched go first in the song-by-song
-- search too. It only links an exact title match by the song's own artist
-- (match-spotify), and each song is searched once.

create or replace function public.sc_spotify_match_next(p_limit integer default 10)
returns table(id text, title text, release_status text, album text, release_date date, artist text, others text[])
language sql stable security definer set search_path to 'public'
as $function$
  with lim as (select greatest(1, least(coalesce(p_limit, 10), 50)) n),
  arts as (
    select a0.id, a0.name, coalesce(w.weight, 0) wt, (l.artist_id is not null) launch
    from artists a0
    left join sc_artist_weights() w on w.artist_id = a0.id
    left join launch_artists l on l.artist_id = a0.id
    where (coalesce(a0.spotify_artist_id, '') !~ '^[A-Za-z0-9]{22}$' or l.artist_id is not null)
      and not a0.catalogue_hold
  ),
  todo as (
    select x.*, ar.name artist_name, ar.wt, ar.launch
    from arts ar
    cross join lim
    cross join lateral (
      select t.id, t.title, t.release_status, t.album, t.release_date, t.artist_id,
             row_number() over (order by (t.parent_track_id is null) desc, t.id) turn
      from tracks t
      where t.artist_id = ar.id
        and t.spotify_url is null and t.spotify_search_attempted_at is null
        and coalesce(t.release_status, '') not in ('leaked', 'snippet', 'announced', 'rumored', 'teased')
        -- Main artists (who have a Spotify profile): main songs only.
        and (not ar.launch or t.parent_track_id is null)
      order by (t.parent_track_id is null) desc, t.id
      limit lim.n
    ) x
  )
  select d.id, d.title, d.release_status, d.album, d.release_date, d.artist_name,
         array(select a2.name from track_appearances ap join artists a2 on a2.id = ap.artist_id where ap.track_id = d.id)
  from todo d
  order by d.launch desc, (d.wt > 0) desc, d.turn, d.wt desc, d.artist_id
  limit (select n from lim);
$function$;
