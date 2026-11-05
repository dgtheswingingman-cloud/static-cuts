-- Extra bits for the collab map: each artist's main genre tag (their
-- highest-weighted tag, used to colour scenes) and the newest collab songs.
create or replace function rpc_collab_extras()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  with top as (
    select distinct on (artist_id) artist_id, lower(trim(tag)) tag
    from artist_genre_tags order by artist_id, weight desc nulls last, created_at
  ),
  songs as (
    select distinct on (t.id) t.id, t.title, t.cover_url, coalesce(t.release_date, t.leak_date) d, e.x, e.y
    from collab_edges e cross join lateral unnest(e.tracks) tid join tracks t on t.id = tid
    where coalesce(t.release_date, t.leak_date) <= current_date
    order by t.id, e.songs desc
  )
  select jsonb_build_object(
    'genres', (select coalesce(jsonb_object_agg(artist_id, tag), '{}'::jsonb) from top),
    'recent', (select coalesce(jsonb_agg(r order by r.d desc), '[]'::jsonb) from
                (select id, title, cover_url, d, x a, y b from songs order by d desc limit 12) r));
$$;
grant execute on function rpc_collab_extras() to anon, authenticated;
