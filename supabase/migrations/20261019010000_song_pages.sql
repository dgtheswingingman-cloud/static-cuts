-- Song pages (/song/<id>).
--
-- One call returns everything a song page shows: the song, its artist, the
-- other versions of it, the artists it appears under, its status history,
-- who added it (if they show contributions), and for the viewer: whether
-- they've collected it and their rating. The community average is only
-- included once the viewer has rated, like on artist pages.
--
-- An id that was merged away returns {"redirect": "<new id>"} so old links
-- keep working.

create or replace function rpc_song_page(p_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  t tracks%rowtype;
  v_id text := p_id;
  v_main text;
  v_me uuid := auth.uid();
  v_my int;
  i int := 0;
begin
  select * into t from tracks where id = v_id;
  -- Follow merges (a chain of at most 5).
  while t.id is null and i < 5 loop
    select new_track_id into v_id from track_redirects where old_track_id = v_id;
    exit when v_id is null;
    select * into t from tracks where id = v_id;
    i := i + 1;
  end loop;
  if t.id is null then return null; end if;
  if t.id <> p_id then return jsonb_build_object('redirect', t.id); end if;

  v_main := coalesce(t.parent_track_id, t.id);
  if v_me is not null then
    select value into v_my from ratings where user_id = v_me and track_id = t.id;
  end if;

  return jsonb_build_object(
    'track', jsonb_build_object(
      'id', t.id, 'title', t.title, 'artist_id', t.artist_id, 'spotify_url', t.spotify_url,
      'parent_track_id', t.parent_track_id, 'is_featured', t.is_featured, 'is_official', t.is_official,
      'has_audio', t.has_audio, 'aliases', t.aliases, 'track_number', t.track_number,
      'release_date', t.release_date, 'producers', t.producers, 'featured_artists', t.featured_artists,
      'genre', t.genre, 'notes', t.notes, 'album', t.album, 'release_status', t.release_status,
      'created_at', t.created_at, 'source', t.source, 'source_url', t.source_url),
    'artist', (select jsonb_build_object('id', a.id, 'name', a.name) from artists a where a.id = t.artist_id),
    -- The main song and all its versions, main first.
    'family', (select coalesce(jsonb_agg(jsonb_build_object(
                 'id', f.id, 'title', f.title, 'release_status', f.release_status,
                 'is_official', f.is_official, 'spotify_url', f.spotify_url, 'is_main', f.id = v_main)
                 order by (f.id = v_main) desc, f.release_date nulls last, f.title), '[]'::jsonb)
               from tracks f where f.id = v_main or f.parent_track_id = v_main),
    'appears_on', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name) order by a.name), '[]'::jsonb)
                   from track_appearances ap join artists a on a.id = ap.artist_id
                   where ap.track_id = t.id and ap.artist_id <> t.artist_id),
    'history', (select coalesce(jsonb_agg(jsonb_build_object('from', e.from_status, 'to', e.to_status, 'at', e.created_at)
                  order by e.created_at), '[]'::jsonb)
                from track_status_events e where e.track_id = t.id),
    'added_by', (select jsonb_build_object('id', p.id, 'name', coalesce(p.display_name, 'someone'))
                 from profiles p where p.id = t.added_by and sc_contributions_visible(t.added_by)),
    'collectors', (select count(*) from track_ownership where track_id = t.id),
    'comments', (select count(*) from comments where track_id = t.id),
    'owned', v_me is not null and exists (select 1 from track_ownership where user_id = v_me and track_id = t.id),
    'my_rating', v_my,
    'rating', case when v_my is null then
                (select jsonb_build_object('count', rating_count) from track_rating_stats where track_id = t.id)
              else
                (select jsonb_build_object('avg', round(avg_rating, 1), 'count', rating_count)
                 from track_rating_stats where track_id = t.id) end
  );
end;
$$;

revoke execute on function rpc_song_page(text) from public;
grant execute on function rpc_song_page(text) to anon, authenticated;

create index if not exists track_status_events_track_idx on track_status_events (track_id, created_at);
