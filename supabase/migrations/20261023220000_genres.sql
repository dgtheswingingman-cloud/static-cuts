-- Genres, properly:
--  * Filled in automatically from Last.fm's top tags for each artist (the
--    artist-info timer, within the Last.fm allowance). People can still add
--    and vote on tags; votes count for more than Last.fm's order.
--  * Each genre has a page (/genre/<slug>) and there's a list of all genres.
--  * Similar artists on artist pages: Last.fm's "similar artists" that are
--    in the archive first, then artists sharing the most genres.
--  * The homepage artist list can be filtered by genre.

alter table artist_genre_tags add column if not exists source text;
alter table artist_genre_tags add column if not exists weight int;
alter table artists add column if not exists genres_checked_at timestamptz;
alter table artists add column if not exists lastfm_similar text[];

create or replace function sc_genre_slug(p text)
returns text
language sql
immutable
as $$
  select btrim(regexp_replace(lower(replace(coalesce(p, ''), '&', 'n')), '[^a-z0-9]+', '-', 'g'), '-');
$$;
create index if not exists artist_genre_tags_slug_idx on artist_genre_tags (sc_genre_slug(tag));
create index if not exists artist_genre_tags_artist_idx on artist_genre_tags (artist_id);

-- Votes plus where the tag came from. New columns go at the end.
create or replace view artist_genre_tag_stats as
  select t.id, t.artist_id, t.tag, t.created_by, count(v.user_id) as vote_count, t.source, t.weight
  from artist_genre_tags t left join artist_genre_tag_votes v on v.tag_id = t.id
  group by t.id, t.artist_id, t.tag, t.created_by, t.source, t.weight;

-- How much a tag counts for an artist: each vote 3, Last.fm's top tag 5
-- down to 1 for its fifth.
create or replace function sc_artist_genres()
returns table(artist_id text, slug text, tag text, score int)
language sql
stable
security definer
set search_path to 'public'
as $$
  -- Name as people wrote it if anyone did, otherwise Last.fm's.
  select t.artist_id, sc_genre_slug(t.tag), (array_agg(t.tag order by t.source nulls first, t.created_at))[1],
         (sum(coalesce(t.weight, 0)) + 3 * sum((select count(*) from artist_genre_tag_votes v where v.tag_id = t.id)))::int
  from artist_genre_tags t
  where sc_genre_slug(t.tag) <> ''
  group by t.artist_id, sc_genre_slug(t.tag);
$$;
revoke execute on function sc_artist_genres() from public, anon, authenticated;

-- The timer's list: artists whose genres haven't been looked up (or not for
-- six months). Followed and big artists first.
create or replace function sc_artist_genres_next(p_secret text, p_limit int default 30)
returns table(artist_id text, name text, lastfm_name text)
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then
    raise exception 'not authorized';
  end if;
  return query
  select a.id, a.name, a.lastfm_name
  from artists a
  left join sc_artist_weights() w on w.artist_id = a.id
  left join artist_track_counts c on c.artist_id = a.id
  where a.genres_checked_at is null or a.genres_checked_at < now() - interval '180 days'
  order by a.genres_checked_at nulls first, coalesce(w.weight, 0) desc, coalesce(c.n, 0) desc
  limit greatest(1, least(coalesce(p_limit, 30), 60));
end;
$$;
revoke execute on function sc_artist_genres_next(text, int) from public, anon, authenticated;

-- Save what Last.fm said: [{artist_id, tags: [..top first], similar: [names]}].
create or replace function sc_artist_genres_save(p_secret text, p_items jsonb)
returns int
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  it jsonb;
  tg record;
  v_id uuid;
  n int := 0;
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then
    raise exception 'not authorized';
  end if;
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]')) loop
    if not exists (select 1 from artists where id = it ->> 'artist_id') then continue; end if;
    for tg in
      select left(btrim(x), 40) tag, ord from jsonb_array_elements_text(coalesce(it -> 'tags', '[]')) with ordinality y(x, ord)
      where sc_genre_slug(x) <> '' and ord <= 5
    loop
      select id into v_id from artist_genre_tags
      where artist_id = it ->> 'artist_id' and sc_genre_slug(tag) = sc_genre_slug(tg.tag) limit 1;
      if v_id is null then
        insert into artist_genre_tags (artist_id, tag, created_by, source, weight)
        values (it ->> 'artist_id', tg.tag, null, 'lastfm', 6 - tg.ord::int);
      else
        update artist_genre_tags set weight = 6 - tg.ord::int where id = v_id;
      end if;
    end loop;
    update artists set genres_checked_at = now(),
      lastfm_similar = (select array_agg(left(btrim(x), 200)) from jsonb_array_elements_text(coalesce(it -> 'similar', '[]')) x where btrim(x) <> '')
    where id = it ->> 'artist_id';
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function sc_artist_genres_save(text, jsonb) from public, anon, authenticated;

-- All genres with how many artists have them.
create or replace function rpc_genres()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(jsonb_build_object('slug', slug, 'tag', tag, 'artists', n) order by n desc, tag), '[]'::jsonb)
  from (select slug, mode() within group (order by tag) tag, count(*) n from sc_artist_genres() group by slug) g;
$$;
grant execute on function rpc_genres() to anon, authenticated;

-- One genre: its artists (strongest first) and genres that often go with it.
create or replace function rpc_genre(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  with g as (select * from sc_artist_genres()),
  mine as (select * from g where slug = p_slug)
  select case when not exists (select 1 from mine) then null else jsonb_build_object(
    'slug', p_slug,
    'tag', (select tag from mine group by tag order by count(*) desc limit 1),
    'artists', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'image_url', a.image_url,
                                                           'songs', coalesce(c.n, 0))
                                        order by m.score desc, coalesce(c.n, 0) desc, a.name), '[]'::jsonb)
                from mine m join artists a on a.id = m.artist_id left join artist_track_counts c on c.artist_id = a.id),
    'related', (select coalesce(jsonb_agg(jsonb_build_object('slug', slug, 'tag', tag, 'n', n) order by n desc), '[]'::jsonb)
                from (select o.slug, mode() within group (order by o.tag) tag, count(*) n from g o join mine m on m.artist_id = o.artist_id
                      where o.slug <> p_slug group by o.slug order by count(*) desc limit 12) r)
  ) end;
$$;
grant execute on function rpc_genre(text) to anon, authenticated;

-- Artists like this one.
create or replace function rpc_similar_artists(p_artist text, p_limit int default 10)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  with keys as (
    select sc_normalize_title(name) k, id artist_id from artists
    union select alias_key, artist_id from artist_aliases where alias_key is not null
  ), lf as (
    select k.artist_id, min(s.ord) ord
    from artists me, unnest(me.lastfm_similar) with ordinality s(name, ord)
    join keys k on k.k = sc_normalize_title(s.name)
    where me.id = p_artist and k.artist_id <> p_artist
    group by k.artist_id
  ), g as (select * from sc_artist_genres()),
  shared as (
    select o.artist_id, sum(least(o.score, m.score)) score, array_agg(o.tag order by m.score desc) tags
    from g m join g o on o.slug = m.slug and o.artist_id <> m.artist_id
    where m.artist_id = p_artist
    group by o.artist_id
  ), pick as (
    select coalesce(lf.artist_id, s.artist_id) artist_id, lf.ord, coalesce(s.score, 0) score, s.tags
    from lf full join shared s on s.artist_id = lf.artist_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'image_url', a.image_url,
                                                'why', case when p.ord is not null then 'similar on Last.fm' else array_to_string(p.tags[1:2], ', ') end)
                            order by p.ord nulls last, p.score desc, coalesce(c.n, 0) desc), '[]'::jsonb)
  from (select * from pick order by ord nulls last, score desc limit greatest(1, least(coalesce(p_limit, 10), 30))) p
  join artists a on a.id = p.artist_id
  left join artist_track_counts c on c.artist_id = a.id;
$$;
grant execute on function rpc_similar_artists(text, int) to anon, authenticated;

-- Homepage artists now carry their top genres (for the genre filter).
create or replace function rpc_home_artists(p_mine boolean default true)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  with mine as (
    select t.artist_id, count(*) n
    from track_ownership o join tracks t on t.id = o.track_id
    where p_mine and auth.uid() is not null and o.user_id = auth.uid()
    group by t.artist_id
  ), nick as (
    select artist_id, array_agg(alias order by alias) aliases from artist_aliases group by artist_id
  ), gen as (
    select artist_id, jsonb_agg(jsonb_build_object('slug', slug, 'tag', tag) order by score desc) genres
    from (select *, row_number() over (partition by artist_id order by score desc, slug) rn from sc_artist_genres()) x
    where rn <= 4 group by artist_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'name', a.name, 'status', a.status,
    'track_count', coalesce(c.n, 0), 'collected', coalesce(m.n, 0),
    'avg_rating', r.avg_rating, 'rating_count', coalesce(r.rating_count, 0),
    'aliases', coalesce(k.aliases, '{}'), 'genres', coalesce(gn.genres, '[]'::jsonb)
  ) order by a.name), '[]'::jsonb)
  from artists a
  left join artist_track_counts c on c.artist_id = a.id
  left join mine m on m.artist_id = a.id
  left join artist_rating_stats r on r.artist_id = a.id
  left join nick k on k.artist_id = a.id
  left join gen gn on gn.artist_id = a.id;
$$;
