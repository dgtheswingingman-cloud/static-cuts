-- Home page: "Featured" order and photos in one call (11 Nov 2026).
--
-- The home page loaded every artist (1,800) and then their photos in two
-- more requests, and drew every card at once. Now the one call carries each
-- artist's photo, and a "featured" position: a daily-shuffled mix of
--   popular      500k+ Deezer fans, lots of ListenBrainz listeners, or 3+ followers here
--   underground  the middle
--   deep         under 20k Deezer fans (or no data, few songs, nobody following)
-- about 1 popular : 2 underground : 1 deep, artists with a photo first in
-- each group. The list (without your collection numbers) is kept for 10
-- minutes.
create or replace function sc_home_artists_base()
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v jsonb; v_cut numeric;
begin
  select data into v from home_cache where key = 'home_artists:' || current_date and refreshed_at > now() - interval '10 minutes';
  if v is not null then return v; end if;

  with lb as (
    select t.artist_id, max(p.listeners) listeners
    from track_popularity p join tracks t on t.id = p.track_id group by 1
  ),
  fol as (select artist_id, count(*) n from follows group by 1),
  nick as (select artist_id, array_agg(alias order by alias) aliases from artist_aliases group by artist_id),
  gen as (
    select artist_id, jsonb_agg(jsonb_build_object('slug', slug, 'tag', tag) order by score desc) genres
    from (select *, row_number() over (partition by artist_id order by score desc, slug) rn from sc_artist_genres()) x
    where rn <= 4 group by artist_id
  ),
  base as (
    select a.id, a.name, a.status, a.image_url, coalesce(c.n, 0) track_count, coalesce(f.n, 0) followers, lb.listeners, a.deezer_fans fans,
           r.avg_rating, coalesce(r.rating_count, 0) rating_count, coalesce(k.aliases, '{}') aliases, coalesce(gn.genres, '[]'::jsonb) genres
    from artists a
    left join artist_track_counts c on c.artist_id = a.id
    left join fol f on f.artist_id = a.id
    left join lb on lb.artist_id = a.id
    left join artist_rating_stats r on r.artist_id = a.id
    left join nick k on k.artist_id = a.id
    left join gen gn on gn.artist_id = a.id
  ),
  cut as (select percentile_cont(0.6) within group (order by listeners) c from base where listeners is not null),
  tiered as (
    select b.*, case
      when coalesce(b.fans, 0) >= 500000 or coalesce(b.listeners, 0) >= (select c from cut) or b.followers >= 3 then 'popular'
      when b.fans < 20000 or (b.fans is null and b.listeners is null and b.followers = 0 and b.track_count <= 40) then 'deep'
      else 'underground' end tier
    from base b where b.track_count > 0
  ),
  ranked as (
    select t.*, row_number() over (partition by tier order by (image_url is null), md5(id || current_date::text)) rn
    from tiered t
  ),
  placed as (
    select r.*, r.rn / case tier when 'popular' then 0.25 when 'underground' then 0.5 else 0.25 end pos from ranked r
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.name, 'status', p.status, 'image', p.image_url,
      'track_count', p.track_count, 'avg_rating', p.avg_rating, 'rating_count', p.rating_count,
      'aliases', p.aliases, 'genres', p.genres, 'tier', p.tier, 'featured', p.featured)
    order by p.name), '[]'::jsonb) into v
  from (select pl.*, row_number() over (order by pl.pos, md5(pl.id)) featured from placed pl
        union all
        select b.*, 'deep', 0::bigint, 0::numeric, 100000 + row_number() over (order by b.name) from base b where b.track_count = 0) p;

  insert into home_cache (key, data, refreshed_at) values ('home_artists:' || current_date, v, now())
  on conflict (key) do update set data = excluded.data, refreshed_at = excluded.refreshed_at;
  return v;
end $function$;
revoke execute on function sc_home_artists_base() from public, anon, authenticated;

create or replace function rpc_home_artists(p_mine boolean default true)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v jsonb := sc_home_artists_base(); m jsonb;
begin
  if not p_mine or auth.uid() is null then return v; end if;
  select jsonb_object_agg(artist_id, n) into m from (
    select t.artist_id, count(*) n from track_ownership o join tracks t on t.id = o.track_id
    where o.user_id = auth.uid() group by 1) x;
  if m is null then return v; end if;
  return (select jsonb_agg(e || jsonb_build_object('collected', coalesce((m ->> (e ->> 'id'))::int, 0))) from jsonb_array_elements(v) e);
end $function$;
grant execute on function rpc_home_artists(boolean) to anon, authenticated;
