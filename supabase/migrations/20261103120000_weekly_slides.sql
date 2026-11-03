-- Weekly round-up slides: the week's leaks and releases (from rpc_weekly),
-- best first: artists people here follow and have in their Spotify
-- libraries, then bigger archives. At most 2 songs per artist, 6 per list,
-- each with its picture (sc_track_cover).

create or replace function sc_weekly_slide_list(p_songs jsonb)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  with s as (
    select x ->> 'id' as id, x ->> 'title' as title, x ->> 'artist' as artist, x ->> 'artist_id' as artist_id, x ->> 'day' as day
    from jsonb_array_elements(coalesce(p_songs, '[]')) x),
  ranked as (
    select s.*,
      (select count(*) from follows f where f.artist_id = s.artist_id) * 3
      + (select count(*) from spotify_library_artists l join artists a on a.spotify_artist_id = l.spotify_artist_id where a.id = s.artist_id) * 2
      + ln(1 + coalesce((select c.n from artist_track_counts c where c.artist_id = s.artist_id), 0)) as score
    from s),
  per as (select *, row_number() over (partition by artist_id order by day desc, title) as k from ranked),
  top as (select * from per where k <= 2 order by score desc, day desc, title limit 6)
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'artist', artist, 'day', day,
           'cover', sc_track_cover(id) ->> 'url') order by score desc, day desc, title), '[]')
  from top;
$$;
create or replace function rpc_weekly_slides(p_week date)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare w jsonb := rpc_weekly(p_week);
begin
  return jsonb_build_object(
    'week_start', w -> 'week_start',
    'leaked_n', jsonb_array_length(coalesce(w -> 'leaked', '[]')),
    'released_n', jsonb_array_length(coalesce(w -> 'released', '[]')),
    'added_total', coalesce((w ->> 'added_total')::int, 0),
    'leaked', sc_weekly_slide_list(w -> 'leaked'),
    'released', sc_weekly_slide_list(w -> 'released'));
end;
$$;

grant execute on function rpc_weekly_slides(date) to anon, authenticated;
