-- The official albums / EPs a song is on (its main version's, for other
-- versions), oldest release first.
create or replace function rpc_track_albums(p_track text)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  with ids as (select id from tracks where id = p_track union select parent_track_id from tracks where id = p_track and parent_track_id is not null)
  select coalesce(jsonb_agg(x order by x.date nulls last), '[]'::jsonb) from (
    select distinct on (lower(d.title)) at.album_id id, d.title, d.kind, d.cover, d.release_date date, at.position, at.disk
    from album_tracks at join deezer_albums d on d.album_id = at.album_id
    where at.track_id in (select id from ids) and d.kind in ('album', 'ep') and coalesce(d.review, '') <> 'remove'
    order by lower(d.title), d.release_date
  ) x;
$$;
grant execute on function rpc_track_albums(text) to anon, authenticated;
