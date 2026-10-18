-- Collab map (/collabs): who has worked with who.
--
-- Built from three places, so it fills in as the archive grows:
--   - songs linked to more than one artist page (track_appearances)
--   - the featured artists field (filled by imports, e.g. sheets)
--   - "(feat. X)" / "ft. X" in song titles
-- Guests who don't have a page here still show, as names.

-- Names from "feat. A, B & C" text.
create or replace function sc_split_names(p text)
returns setof text
language sql
immutable
as $$
  -- Drop anything after a bracket ("Lil Tracy (Snippet 12.06.25" -> "Lil Tracy").
  select y from (
    select trim(regexp_replace(x, '\s*[\(\[].*$', '')) y
    from regexp_split_to_table(coalesce(p, ''), '\s*(,|&|\mand\M|\mx\M|\+|/)\s*', 'i') x) z
  where length(y) between 2 and 60;
$$;

create or replace function rpc_collab_graph(p_artist text default null)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  with pairs as (
    -- Linked artist pages.
    select t.artist_id a_id, null::text a_name, ap.artist_id b_id, null::text b_name, t.id track_id
    from track_appearances ap join tracks t on t.id = ap.track_id
    where ap.artist_id <> t.artist_id
    union all
    -- Featured artists field.
    select t.artist_id, null, null, n, t.id
    from tracks t, sc_split_names(t.featured_artists) n
    where t.featured_artists is not null and t.featured_artists <> ''
    union all
    -- "(feat. X)" in titles.
    select t.artist_id, null, null, n, t.id
    from tracks t, sc_split_names(substring(t.title from '(?i)\m(?:feat|ft)\.?\s+([^)\]]+)')) n
    where t.title ~* '\m(feat|ft)\.?\s'
  ),
  named as (
    -- Guests with a page here count as that artist.
    select p.a_id, coalesce(p.b_id, a.id) b_id, case when coalesce(p.b_id, a.id) is null then p.b_name end b_name, p.track_id
    from pairs p
    left join lateral (select ar.id from artists ar where lower(ar.name) = lower(p.b_name) limit 1) a on p.b_name is not null
  ),
  edges as (
    select least(a_id, coalesce(b_id, 'guest:' || lower(b_name))) x, greatest(a_id, coalesce(b_id, 'guest:' || lower(b_name))) y,
           max(b_name) guest_name, count(distinct track_id) songs, (array_agg(distinct track_id))[1:5] tracks
    from named
    where coalesce(b_id, '') <> a_id
    group by 1, 2
  ),
  filtered as (
    select * from edges where p_artist is null or x = p_artist or y = p_artist
  ),
  nodes as (
    select k, count(*) degree, sum(songs) songs from (
      select x k, songs from filtered union all select y, songs from filtered) z group by k
  )
  select jsonb_build_object(
    'nodes', (select coalesce(jsonb_agg(jsonb_build_object(
                'key', n.k, 'artist_id', a.id,
                'name', coalesce(a.name, (select max(guest_name) from filtered where x = n.k or y = n.k), substr(n.k, 7)),
                'degree', n.degree, 'songs', n.songs)), '[]'::jsonb)
              from nodes n left join artists a on a.id = n.k),
    'edges', (select coalesce(jsonb_agg(jsonb_build_object('a', x, 'b', y, 'songs', songs, 'tracks', tracks)), '[]'::jsonb) from filtered));
$$;

revoke execute on function rpc_collab_graph(text) from public;
grant execute on function rpc_collab_graph(text) to anon, authenticated;
