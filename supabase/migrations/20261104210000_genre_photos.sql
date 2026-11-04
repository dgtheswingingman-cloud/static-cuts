-- A picture for each genre card: the photo of the genre's most-followed
-- artist that has one (ties: the strongest tag).
create or replace function rpc_genre_photos(p_slugs text[]) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(slug, url), '{}'::jsonb) from (
    select distinct on (g.slug) g.slug, a.image_url url
    from sc_artist_genres() g join artists a on a.id = g.artist_id
    where g.slug = any(p_slugs) and a.image_url is not null
    order by g.slug, (select count(*) from follows f where f.artist_id = a.id) desc, g.score desc
  ) x;
$$;
grant execute on function rpc_genre_photos(text[]) to anon, authenticated;
