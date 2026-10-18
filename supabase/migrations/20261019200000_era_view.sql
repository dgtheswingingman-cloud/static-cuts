-- Era View (/artist/<id>/eras): an artist's main songs with what's needed to
-- lay them out by era (album / project, or year when there's no album).

create or replace function rpc_artist_eras(p_artist text)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select jsonb_build_object(
    'artist', (select jsonb_build_object('id', id, 'name', name) from artists where id = p_artist),
    'songs', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', t.id, 'title', t.title, 'album', nullif(trim(t.album), ''),
        'status', coalesce(t.release_status, case when t.is_official then 'released' else 'unconfirmed' end),
        'release_date', t.release_date, 'leak_date', t.leak_date, 'track_number', t.track_number,
        'cover_url', t.cover_url, 'spotify_url', t.spotify_url,
        'versions', (select count(*) from tracks v where v.parent_track_id = t.id))
        order by coalesce(t.release_date, t.leak_date), t.track_number nulls last, t.title), '[]'::jsonb)
      from tracks t where t.artist_id = p_artist and t.parent_track_id is null));
$$;

revoke execute on function rpc_artist_eras(text) from public;
grant execute on function rpc_artist_eras(text) to anon, authenticated;
