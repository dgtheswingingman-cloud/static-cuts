-- Album editions combined into one album (9 Nov 2026).
--
-- An album and its deluxe / anniversary / remastered editions are one album
-- on the site: the album page lists the original tracklist, then every song
-- that only appears on an edition, tagged with that edition ("Deluxe").
-- Opening an edition's link shows the same combined page. Projects and song
-- pages show the one album.

-- The editions of an album (the album itself included), main one first.
create or replace function sc_album_group(p_album text)
returns table(album_id text, title text, kind text, release_date date, songs int, is_edition boolean, is_main boolean)
language sql stable security definer set search_path to 'public' as $$
  with me as (
    select d.artist_id, coalesce(sc_album_base(d.title), sc_title_key(d.title), lower(d.title)) grp
    from deezer_albums d where d.album_id = p_album and d.kind in ('album', 'ep')
    order by (d.review = 'keep') desc nulls last limit 1
  ),
  g as (
    select distinct on (d.album_id) d.album_id, d.title, d.kind, d.release_date, d.songs,
           sc_album_base(d.title) is distinct from sc_title_key(d.title) is_edition
    from deezer_albums d, me
    where d.artist_id = me.artist_id and d.kind in ('album', 'ep') and coalesce(d.review, '') <> 'remove'
      and coalesce(sc_album_base(d.title), sc_title_key(d.title), lower(d.title)) = me.grp
    order by d.album_id
  )
  select g.*, row_number() over (order by g.is_edition,
           g.is_edition and sc_edition_label(g.title) ~* '(deluxe|expanded|bonus|complete|anniversary|super)',
           g.release_date nulls last, g.songs desc nulls last, g.album_id) = 1
  from g
$$;
revoke execute on function sc_album_group(text) from public, anon, authenticated;

create or replace function rpc_album(p_album text)
returns jsonb language sql stable security definer set search_path to 'public' as $function$
  with grp as (select * from sc_album_group(p_album)),
  m as (select coalesce((select album_id from grp where is_main), p_album) id),
  al as (
    select d.*, a.name artist_name, a.image_url artist_image from deezer_albums d join artists a on a.id = d.artist_id, m
    where d.album_id = m.id order by (d.review = 'keep') desc nulls last, d.songs desc nulls last limit 1
  ),
  main_tl as (select at.* from album_tracks at, m where at.album_id = m.id),
  -- Songs only on an edition, after the original tracklist.
  extra as (
    select x.*, (select coalesce(max(position), 0) from main_tl) + row_number() over (order by x.ord) pos2,
           (select max(disk) from main_tl) disk2
    from (
      select distinct on (sc_title_key(at.title)) at.*, sc_edition_label(g.title) edition,
             row_number() over (order by g.release_date nulls last, g.album_id, at.disk, at.position) ord
      from grp g join album_tracks at on at.album_id = g.album_id, m
      where g.album_id <> m.id
        and (at.track_id is null or at.track_id not in (select track_id from main_tl where track_id is not null))
        and sc_title_key(at.title) not in (select sc_title_key(title) from main_tl)
      order by sc_title_key(at.title), g.release_date nulls last, g.album_id, at.disk, at.position
    ) x
  ),
  tl as (
    select at.disk, at.position, at.title, at.artist, at.duration, at.explicit, at.track_id, null::text edition from main_tl at
    union all
    select e.disk2, e.pos2::int, e.title, e.artist, e.duration, e.explicit, e.track_id, e.edition from extra e
  ),
  tl2 as (
    select tl.*, t.title site_title, coalesce(t.release_status, case when t.is_official then 'released' else 'unconfirmed' end) status,
           t.artist_id, s.avg_rating, coalesce(s.rating_count, 0) rating_count,
           (select count(*) from tracks v where v.parent_track_id = t.id) versions
    from tl left join tracks t on t.id = tl.track_id left join track_rating_stats s on s.track_id = tl.track_id
  ),
  fallback as (
    select null::int disk, t.track_number position, t.title, null::text artist, t.length_sec duration, t.explicit, t.id track_id,
           null::text edition, t.title site_title, coalesce(t.release_status, case when t.is_official then 'released' else 'unconfirmed' end) status,
           t.artist_id, s.avg_rating, coalesce(s.rating_count, 0) rating_count, 0::bigint versions
    from tracks t join al on t.artist_id = al.artist_id and lower(t.album) = lower(al.title) and t.parent_track_id is null
    left join track_rating_stats s on s.track_id = t.id
    where not exists (select 1 from tl2)
  ),
  rows as (select * from tl2 union all select * from fallback)
  select case when not exists (select 1 from al) then null else jsonb_build_object(
    'id', (select album_id from al), 'title', (select title from al), 'kind', (select kind from al),
    'date', (select release_date from al), 'cover', (select cover from al), 'label', (select label from al),
    'link', (select link from al), 'songs', (select songs from al),
    'artist', jsonb_build_object('id', (select artist_id from al), 'name', (select artist_name from al), 'image', (select artist_image from al)),
    'complete', exists (select 1 from main_tl),
    'length', (select sum(duration) from rows),
    'score', (select round(avg(avg_rating), 1) from rows where avg_rating is not null),
    'rated', (select count(*) from rows where avg_rating is not null),
    'votes', (select coalesce(sum(rating_count), 0) from rows),
    'tracks', (select coalesce(jsonb_agg(to_jsonb(r) order by r.disk nulls first, r.position nulls last, r.title), '[]'::jsonb) from rows r),
    'editions', (select coalesce(jsonb_agg(jsonb_build_object('id', g.album_id, 'title', g.title,
                   'label', case when g.is_main then 'Original' else sc_edition_label(g.title) end,
                   'date', g.release_date, 'songs', g.songs,
                   'extra', (select count(*) from extra e where e.album_id = g.album_id))
                 order by not g.is_main, g.release_date nulls last), '[]'::jsonb)
                 from grp g where (select count(*) from grp) > 1),
    'more', (select coalesce(jsonb_agg(jsonb_build_object('id', x.album_id, 'title', x.title, 'cover', x.cover, 'date', x.release_date, 'kind', x.kind) order by x.release_date desc), '[]'::jsonb)
             from (select distinct on (coalesce(sc_album_base(d.title), lower(d.title))) d.album_id, d.title, d.cover, d.release_date, d.kind from deezer_albums d, al
                   where d.artist_id = al.artist_id and d.kind in ('album', 'ep') and coalesce(d.review, '') <> 'remove'
                     and d.album_id not in (select album_id from grp) and d.album_id <> al.album_id
                   order by coalesce(sc_album_base(d.title), lower(d.title)),
                            sc_album_base(d.title) is distinct from sc_title_key(d.title), d.release_date nulls last) x)
  ) end;
$function$;

-- Projects: one tile per album; songs counts the combined tracklist.
do $$
declare d text := pg_get_functiondef('rpc_artist_projects(text)'::regprocedure);
begin
  d := replace(d, $q$'cover', al.cover, 'songs', al.songs,$q$,
                  $q$'cover', al.cover, 'songs', greatest(al.songs, (select max(s2.songs) from src s2 where s2.grp = al.grp)),$q$);
  if position('s2.grp = al.grp' in d) = 0 then raise exception 'projects patch failed'; end if;
  execute d;
end $$;

-- Song pages: the one combined album, tagged when the song is edition-only.
create or replace function rpc_track_albums(p_track text)
returns jsonb language sql stable security definer set search_path to 'public' as $function$
  with ids as (select id from tracks where id = p_track union select parent_track_id from tracks where id = p_track and parent_track_id is not null),
  hits as (
    select at.album_id, at.position, at.disk, d.title, d.kind, d.release_date
    from album_tracks at join deezer_albums d on d.album_id = at.album_id
    where at.track_id in (select id from ids) and d.kind in ('album', 'ep') and coalesce(d.review, '') <> 'remove'
  ),
  mapped as (
    select h.*, coalesce((select g.album_id from sc_album_group(h.album_id) g where g.is_main), h.album_id) main_id from hits h
  ),
  x as (
    select distinct on (mp.main_id) mp.main_id id, md.title, md.kind, md.cover, md.release_date date,
           case when mp.album_id = mp.main_id then mp.position end position, mp.disk,
           case when exists (select 1 from mapped z where z.main_id = mp.main_id and z.album_id = z.main_id) then null
                else sc_edition_label(mp.title) end edition
    from mapped mp join lateral (select * from deezer_albums d where d.album_id = mp.main_id limit 1) md on true
    order by mp.main_id, (mp.album_id = mp.main_id) desc, mp.release_date nulls last
  )
  select coalesce(jsonb_agg(x order by x.date nulls last), '[]'::jsonb) from x;
$function$;
