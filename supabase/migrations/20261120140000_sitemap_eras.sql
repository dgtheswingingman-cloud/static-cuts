-- Artists whose era page is worth listing in the sitemap: 20+ main songs.
create or replace function public.rpc_sitemap_eras()
returns text[]
language sql
stable security definer
set search_path to 'public'
as $$
  select coalesce(array_agg(artist_id order by n desc), '{}')
  from (select artist_id, count(*) n from tracks where parent_track_id is null group by artist_id having count(*) >= 20) x;
$$;
grant execute on function public.rpc_sitemap_eras() to anon, authenticated;
