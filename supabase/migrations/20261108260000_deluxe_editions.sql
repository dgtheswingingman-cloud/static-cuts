-- Deluxe / anniversary / remastered editions (8 Nov 2026).
--
-- 1. One rule for "this album name is an edition of that one":
--    sc_edition_base() strips a trailing "(... Deluxe ...)", "[... Edition]",
--    "(Remastered 2004)", "- 2014 Remaster" etc., wherever the keyword sits in
--    the brackets ("Tenth Anniversary Edition", "Collector's Edition").
--    "(Taylor's Version)" and anything marked live are left alone.
-- 2. Duplicate auto-merge: same song on the original and its deluxe edition
--    is merged into the copy on the original album. Empty copies that only
--    hold versions are folded into a released album copy too (versions move).
-- 3. Artist Projects: each album once (the original), with its editions.
-- 4. Song pages: original album first; editions flagged so they show as
--    "Also on".

create or replace function sc_edition_base(p text)
returns text language sql immutable parallel safe as $$
  select btrim(regexp_replace(regexp_replace(regexp_replace(lower(coalesce(p, '')),
    '\s+[-–]\s+(?![^-–]*\mlive\M)[^-–]*\m(deluxe|remaster(ed)?|edition|anniversary|expanded|reissue)\M[^-–]*$', ''),
    '\s*[\(\[](?![^\)\]]*\mlive\M)[^\)\]]*\m(deluxe|expanded|remaster(ed)?|anniversary|edition|bonus|reissue|explicit|clean)\M[^\)\]]*[\)\]]\s*$', ''),
    '\s*[\(\[](?![^\)\]]*\mlive\M)[^\)\]]*\m(deluxe|expanded|remaster(ed)?|anniversary|edition|bonus|reissue|explicit|clean)\M[^\)\]]*[\)\]]\s*$', ''))
$$;

create or replace function sc_album_base(p text)
returns text language sql immutable parallel safe as $$
  select nullif(sc_title_key(sc_edition_base(p)), '')
$$;

-- What the edition calls itself: "Deluxe", "Tenth Anniversary Edition".
create or replace function sc_edition_label(p text)
returns text language sql immutable parallel safe as $$
  select btrim(coalesce(substring(p from '[\(\[]([^\(\)\[\]]*)[\)\]]\s*$'), substring(p from '\s[-–]\s(.*)$'), 'Edition'))
$$;

-- ---------- 2. Duplicate auto-merge ----------
create or replace function sc_duplicate_auto_merge(p_limit int default 200)
returns int language plpgsql security definer set search_path to 'public' as $function$
declare g record; v_keep text; v_rest text[]; n int := 0;
begin
  perform set_config('static_cuts.system_job', 'version-auto-clear', true);
  for g in
    with dup as (
      select k.artist_id, k.key, k.track_id, k.generic from track_title_keys k
      where k.is_main and k.key <> ''
        and (k.artist_id, k.key) in (select artist_id, key from track_title_keys where is_main and key <> ''
                                      group by 1, 2 having count(*) > 1)
    ),
    t as (
      select d.artist_id, d.key, d.generic, t.id, t.spotify_url, t.isrc, t.length_sec, t.created_at, t.release_status,
             t.album is not null has_album,
             case when t.album is not null then sc_title_key(t.album) end ak,
             case when t.album is not null then sc_album_base(t.album) end ab,
             (t.spotify_url is null and t.isrc is null and t.length_sec is null and t.album is null and t.producers is null
              and t.deezer_url is null and t.apple_url is null
              and coalesce(t.release_status, 'unconfirmed') in ('unconfirmed', 'released')
              and not exists (select 1 from track_ownership o where o.track_id = t.id)
              and not exists (select 1 from ratings r where r.track_id = t.id)
              and not exists (select 1 from comments c where c.track_id = t.id)) shell,
             exists (select 1 from tracks v where v.parent_track_id = t.id) has_versions,
             (t.spotify_url is not null)::int + (t.isrc is not null)::int + (t.length_sec is not null)::int
               + (t.album is not null)::int + (t.producers is not null)::int fullness
      from dup d join tracks t on t.id = d.track_id
    )
    select keep, ids from (
      -- Same Spotify link, or same ISRC, on every copy.
      select null::text keep, array_agg(id) ids from t
      group by artist_id, key
      having (count(distinct spotify_url) = 1 and count(spotify_url) = count(*))
          or (count(distinct isrc) = 1 and count(isrc) = count(*))
      union all
      -- Same album, same length, nothing clashing.
      select null, array_agg(id) from t
      where coalesce(ak, '') <> '' and length_sec is not null
      group by artist_id, key, ak
      having count(*) > 1 and max(length_sec) - min(length_sec) <= 2
         and count(distinct spotify_url) <= 1 and count(distinct isrc) <= 1
      union all
      -- Original album and its deluxe / anniversary / remastered editions:
      -- kept on the copy from the original album.
      select (array_agg(id order by ak is distinct from ab, fullness desc, created_at nulls last, id))[1], array_agg(id) from t
      where not generic and ab is not null
      group by artist_id, key, ab
      having count(*) > 1 and coalesce(max(length_sec) - min(length_sec), 0) <= 2 and count(distinct isrc) <= 1
      union all
      -- Empty copies, into the fullest copy of the same title. An empty copy
      -- holding versions only goes into a released copy on an album.
      select (select r.id from t r where r.artist_id = s.artist_id and r.key = s.key and not r.shell
              order by r.fullness desc, r.created_at nulls last, r.id limit 1),
             array_agg(s.id)
      from t s
      where s.shell and not s.generic
        and exists (select 1 from t r where r.artist_id = s.artist_id and r.key = s.key and not r.shell
                    and (not s.has_versions or (r.has_album and r.release_status = 'released')))
      group by s.artist_id, s.key
    ) z
    limit greatest(1, least(coalesce(p_limit, 200), 2000))
  loop
    if g.keep is not null and exists (select 1 from tracks where id = g.keep) then
      v_keep := g.keep;
    else
      select t.id into v_keep from tracks t
      where t.id = any (g.ids)
      order by (select count(*) from track_ownership o where o.track_id = t.id)
             + (select count(*) from ratings r where r.track_id = t.id)
             + (select count(*) from tracks v where v.parent_track_id = t.id)
             + (select count(*) from comments c where c.track_id = t.id) desc,
               t.created_at nulls last, t.id
      limit 1;
    end if;
    v_rest := array(select i from unnest(g.ids) i where i <> v_keep and exists (select 1 from tracks where id = i));
    continue when v_keep is null or cardinality(v_rest) = 0;
    perform set_config('static_cuts.batch_id', '', true);
    perform admin_merge_duplicates(v_keep, v_rest);
    n := n + cardinality(v_rest);
  end loop;
  perform set_config('static_cuts.batch_id', '', true);
  perform set_config('static_cuts.system_job', '', true);
  return n;
end $function$;
revoke execute on function sc_duplicate_auto_merge(int) from public, anon, authenticated;

-- ---------- 3. Artist Projects ----------
create or replace function rpc_artist_projects(p_artist text)
returns jsonb language sql stable security definer set search_path to 'public' as $function$
  with src as (
    select d.album_id, d.title, d.kind, d.release_date, d.cover, d.songs,
           coalesce(sc_album_base(d.title), sc_title_key(d.title), lower(d.title)) grp,
           sc_album_base(d.title) is distinct from sc_title_key(d.title) is_edition
    from deezer_albums d join artists a on a.id = d.artist_id
    where d.artist_id = p_artist and d.kind in ('album', 'ep')
      and coalesce(d.review, '') <> 'remove' and (d.review = 'keep' or coalesce(a.deezer_check, '') <> 'mixed')
  ),
  al as (
    select distinct on (grp) * from src
    -- The original; when only editions exist, the plainest one (a remaster
    -- before a deluxe), then the earliest.
    order by grp, is_edition, is_edition and sc_edition_label(title) ~* '(deluxe|expanded|bonus|complete|anniversary|super)',
             release_date nulls last, songs desc nulls last
  ),
  ed as (
    select al.album_id main_id,
           jsonb_agg(jsonb_build_object('id', e.album_id, 'title', e.title, 'label', sc_edition_label(e.title))
                     order by e.release_date nulls last) editions
    from al join (select distinct on (grp, lower(title)) * from src order by grp, lower(title), songs desc nulls last) e
      on e.grp = al.grp and lower(e.title) <> lower(al.title)
    group by al.album_id
  ),
  r as (
    select at.album_id, count(distinct s.track_id) rated, round(avg(s.avg_rating), 1) score
    from album_tracks at join track_rating_stats s on s.track_id = at.track_id
    where at.album_id in (select album_id from al) group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', al.album_id, 'title', al.title, 'kind', al.kind, 'date', al.release_date,
    'cover', al.cover, 'songs', al.songs, 'score', r.score, 'rated', coalesce(r.rated, 0),
    'editions', coalesce(ed.editions, '[]'::jsonb)) order by al.release_date desc nulls last), '[]'::jsonb)
  from al left join r on r.album_id = al.album_id left join ed on ed.main_id = al.album_id;
$function$;

-- ---------- 4. Song pages ----------
create or replace function rpc_track_albums(p_track text)
returns jsonb language sql stable security definer set search_path to 'public' as $function$
  with ids as (select id from tracks where id = p_track union select parent_track_id from tracks where id = p_track and parent_track_id is not null),
  x as (
    select distinct on (lower(d.title)) at.album_id id, d.title, d.kind, d.cover, d.release_date date, at.position, at.disk,
           sc_album_base(d.title) is distinct from sc_title_key(d.title) edition
    from album_tracks at join deezer_albums d on d.album_id = at.album_id
    where at.track_id in (select id from ids) and d.kind in ('album', 'ep') and coalesce(d.review, '') <> 'remove'
    order by lower(d.title), d.release_date
  )
  select coalesce(jsonb_agg(x order by x.edition, x.date nulls last), '[]'::jsonb) from x;
$function$;
