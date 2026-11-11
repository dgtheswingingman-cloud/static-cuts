-- Spotify imports keep everything Spotify gives (11 Nov 2026).
--
-- Liked-song / playlist imports (Spotify connection and Exportify files)
-- only kept title, link, album, date, track number and features. Now also:
-- length, ISRC, explicit and the album cover, for new songs AND as gap-fill
-- for songs already here (only empty fields are filled; nothing is
-- overwritten).

create or replace function sc_liked_track_json(p_item jsonb, p_url text, p_pick integer)
returns jsonb language sql immutable set search_path to 'public' as $function$
  select jsonb_strip_nulls(jsonb_build_object(
               'title', btrim(p_item ->> 'title'),
               'spotify_url', p_url,
               'album', case when p_item ->> 'album_type' = 'single' and coalesce((p_item ->> 'total_tracks')::int, 0) = 1
                             then null else nullif(p_item ->> 'album_name', '') end,
               'release_date', case when p_item ->> 'release_precision' = 'day'
                                     and p_item ->> 'release_date' ~ '^\d{4}-\d{2}-\d{2}$' then p_item ->> 'release_date' end,
               'track_number', case when p_item ->> 'album_type' = 'album' then p_item ->> 'track_number' end,
               'length_sec', case when p_item ->> 'duration_ms' ~ '^\d+$' then round((p_item ->> 'duration_ms')::numeric / 1000)::int end,
               'isrc', case when upper(p_item ->> 'isrc') ~ '^[A-Z]{2}[A-Z0-9]{3}\d{7}$' then upper(p_item ->> 'isrc') end,
               'explicit', case when p_item ->> 'explicit' in ('true', 'false') then (p_item ->> 'explicit')::boolean end,
               'cover_url', case when p_item ->> 'cover' ~ '^https://i\.scdn\.co/' then p_item ->> 'cover' end,
               'main_artist_name', case when coalesce(p_pick, 1) > 1 then p_item -> 'artists' -> 0 ->> 'name' end,
               'featured', nullif(array_to_string(array(
                  select x ->> 'name' from jsonb_array_elements(coalesce(p_item -> 'artists', '[]')) with ordinality y(x, o)
                  where o > 1 and o <> coalesce(p_pick, 1)
                  union all
                  select c from jsonb_array_elements_text(coalesce(p_item -> 'credits', '[]')) c), ', '), '')
  ));
$function$;

do $$
declare d text;
begin
  -- New songs: store the extra details.
  d := pg_get_functiondef('sc_import_add_tracks(uuid, jsonb)'::regprocedure);
  d := regexp_replace(d, 'insert into tracks \(id, artist_id, title, spotify_url, release_status, album, release_date, track_number,',
    'insert into tracks (id, artist_id, title, spotify_url, release_status, album, release_date, track_number, length_sec, isrc, explicit, cover_url,');
  d := regexp_replace(d, '(nullif\(it ->> ''release_date'', ''''\)::date, nullif\(it ->> ''track_number'', ''''\)::int,)',
    '\1 nullif(it ->> ''length_sec'', '''')::int, nullif(it ->> ''isrc'', ''''), (it ->> ''explicit'')::boolean, nullif(it ->> ''cover_url'', ''''),');
  -- Songs already here: fill the gaps too.
  d := regexp_replace(d, '(release_date = coalesce\(t\.release_date, nullif\(it ->> ''release_date'', ''''\)::date\))',
    '\1,
        length_sec = coalesce(t.length_sec, nullif(it ->> ''length_sec'', '''')::int),
        isrc = coalesce(t.isrc, nullif(it ->> ''isrc'', '''')),
        explicit = coalesce(t.explicit, (it ->> ''explicit'')::boolean),
        cover_url = coalesce(t.cover_url, nullif(it ->> ''cover_url'', ''''))');
  d := replace(d, 'and (t.spotify_url is null or t.album is null or t.release_date is null);',
    'and (t.spotify_url is null or t.album is null or t.release_date is null or t.length_sec is null or t.isrc is null or t.cover_url is null);');
  if position('length_sec, isrc, explicit, cover_url' in d) = 0 or position('nullif(it ->> ''isrc''' in d) = 0
     or position('t.cover_url is null);' in d) = 0 or position('length_sec = coalesce(t.length_sec' in d) = 0 then
    raise exception 'import patch failed';
  end if;
  execute d;

  -- Liked songs already here (matched by Spotify link): fill their gaps.
  d := pg_get_functiondef('rpc_import_liked_songs(jsonb)'::regprocedure);
  d := regexp_replace(d, '(select count\(\*\) into v_collected from ins;)',
    $q$\1

  -- Songs already here: fill empty details from Spotify's (never overwrite).
  update tracks t set
    length_sec = coalesce(t.length_sec, (j ->> 'length_sec')::int),
    isrc = coalesce(t.isrc, j ->> 'isrc'),
    explicit = coalesce(t.explicit, (j ->> 'explicit')::boolean),
    cover_url = coalesce(t.cover_url, j ->> 'cover_url'),
    album = coalesce(t.album, j ->> 'album'),
    release_date = coalesce(t.release_date, (j ->> 'release_date')::date),
    track_number = coalesce(t.track_number, (j ->> 'track_number')::int)
  from (select distinct on (l.sid) l.sid, sc_liked_track_json(l.item, l.url, l.pick_ord) j from _liked l) x
  where t.spotify_url is not null and substring(t.spotify_url from 'track/([A-Za-z0-9]{22})') = x.sid
    and ((t.length_sec is null and j ? 'length_sec') or (t.isrc is null and j ? 'isrc') or (t.explicit is null and j ? 'explicit')
      or (t.cover_url is null and j ? 'cover_url') or (t.album is null and j ? 'album') or (t.release_date is null and j ? 'release_date')
      or (t.track_number is null and j ? 'track_number'));$q$);
  if position('fill empty details from Spotify' in d) = 0 then raise exception 'liked patch failed'; end if;
  execute d;
end $$;
