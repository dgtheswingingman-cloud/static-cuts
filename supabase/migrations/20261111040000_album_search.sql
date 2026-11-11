-- Album search (11 Nov 2026). Search only looked at the album names typed on
-- songs, and opened the artist's Eras page; official albums (the album
-- pages) weren't searchable. Now: official albums and EPs first (one per
-- album, editions included), opening the album page; then tracker projects
-- that aren't an official album, opening Eras as before.
create or replace function rpc_search_albums(p_q text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare v_q text := lower(trim(coalesce(p_q, ''))); v_like text;
begin
  if length(v_q) < 2 then return jsonb_build_object('albums', '[]'::jsonb, 'projects', '[]'::jsonb); end if;
  v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return jsonb_build_object(
    'albums', (select coalesce(jsonb_agg(x order by x.exact desc, x.songs desc nulls last), '[]'::jsonb) from (
      select distinct on (d.artist_id, sc_album_grp(d.album_id, d.title))
             d.album_id id, d.title, d.artist_id, a.name artist, d.cover, extract(year from d.release_date)::int::text "year", d.kind,
             d.songs, (lower(d.title) = v_q or sc_album_base(d.title) = sc_title_key(v_q)) exact
      from deezer_albums d join artists a on a.id = d.artist_id
      where lower(d.title) like v_like and d.kind in ('album', 'ep') and coalesce(d.review, '') <> 'remove'
        and (d.review = 'keep' or coalesce(a.deezer_check, '') <> 'mixed')
      order by d.artist_id, sc_album_grp(d.album_id, d.title), sc_album_is_edition(d.album_id, d.title), d.release_date nulls last
      limit 200) x),
    'projects', (select coalesce(jsonb_agg(x order by x.songs desc), '[]'::jsonb) from (
      select min(t.album) "name", t.artist_id, min(a.name) artist, min(t.cover_url) cover,
             min(extract(year from t.release_date))::int::text "year", count(*) songs,
             count(*) filter (where t.release_status = 'released') released
      from tracks t join artists a on a.id = t.artist_id
      where lower(t.album) like v_like and t.parent_track_id is null
        and not exists (select 1 from deezer_albums d where d.artist_id = t.artist_id and coalesce(d.review, '') <> 'remove'
                        and coalesce(sc_album_base(d.title), sc_title_key(d.title)) = coalesce(sc_album_base(t.album), sc_title_key(t.album)))
      group by t.artist_id, lower(t.album)
      order by count(*) desc limit 40) x));
end $function$;
grant execute on function rpc_search_albums(text) to anon, authenticated;

-- Fast version (the first took up to 15 s on short words): trigram indexes,
-- a capped candidate list, and an index for "is this project an official album".
create or replace function sc_album_base(p text)
returns text language sql immutable parallel safe as $$
  select nullif(public.sc_title_key(public.sc_edition_base(p)), '')
$$;
create index if not exists deezer_albums_title_trgm on deezer_albums using gin (lower(title) extensions.gin_trgm_ops);
create index if not exists tracks_album_trgm on tracks using gin (lower(album) extensions.gin_trgm_ops) where album is not null and parent_track_id is null;
create index if not exists deezer_albums_base_key on deezer_albums (artist_id, (coalesce(sc_album_base(title), sc_title_key(title))));

create or replace function rpc_search_albums(p_q text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare v_q text := lower(trim(coalesce(p_q, ''))); v_like text;
begin
  if length(v_q) < 2 then return jsonb_build_object('albums', '[]'::jsonb, 'projects', '[]'::jsonb); end if;
  v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return jsonb_build_object(
    'albums', (select coalesce(jsonb_agg(x order by x.exact desc, x.songs desc nulls last), '[]'::jsonb) from (
      select distinct on (m.artist_id, sc_album_grp(m.album_id, m.title))
             m.album_id id, m.title, m.artist_id, a.name artist, m.cover, extract(year from m.release_date)::int::text "year", m.kind,
             m.songs, m.exact
      from (
        select d.*, (lower(d.title) = v_q or sc_album_base(d.title) = sc_title_key(v_q)) exact
        from deezer_albums d
        where lower(d.title) like v_like and d.kind in ('album', 'ep') and coalesce(d.review, '') <> 'remove'
        order by (lower(d.title) = v_q) desc, length(d.title), d.songs desc nulls last
        limit 300
      ) m join artists a on a.id = m.artist_id
      where m.review = 'keep' or coalesce(a.deezer_check, '') <> 'mixed'
      order by m.artist_id, sc_album_grp(m.album_id, m.title), sc_album_is_edition(m.album_id, m.title), m.release_date nulls last
      limit 120) x),
    'projects', (select coalesce(jsonb_agg(x order by x.songs desc), '[]'::jsonb) from (
      select p.* from (
        select min(t.album) "name", t.artist_id, min(a.name) artist, min(t.cover_url) cover,
               min(extract(year from t.release_date))::int::text "year", count(*) songs,
               count(*) filter (where t.release_status = 'released') released
        from (select * from tracks t where lower(t.album) like v_like and t.album is not null and t.parent_track_id is null limit 3000) t
        join artists a on a.id = t.artist_id
        group by t.artist_id, lower(t.album)
        order by count(*) desc limit 80
      ) p
      where not exists (select 1 from deezer_albums d where d.artist_id = p.artist_id and coalesce(d.review, '') <> 'remove'
                        and coalesce(sc_album_base(d.title), sc_title_key(d.title)) = coalesce(sc_album_base(p.name), sc_title_key(p.name)))
      limit 40) x));
end $function$;
