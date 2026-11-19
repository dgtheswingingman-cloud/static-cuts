-- Album pages for the sitemap (its last part). Every album with a tracklist.
create or replace function rpc_sitemap_albums()
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(album_id order by album_id), '[]'::jsonb)
  from (select distinct album_id::text album_id from album_tracks limit 45000) x;
$$;
grant execute on function rpc_sitemap_albums() to anon, authenticated;
