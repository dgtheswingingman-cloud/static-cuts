-- Album pages: each official album / EP's tracklist in order, as Deezer
-- lists it. Saved whenever the Deezer job reads a release; releases read
-- before this are read again (tracklist only, nothing else on the songs
-- changes) when the job has nothing else to do.
create table if not exists album_tracks (
  album_id text not null,
  disk int not null default 1,
  position int not null,
  title text not null,
  artist text,
  duration int,
  explicit boolean,
  link text,
  track_id text references tracks(id) on delete set null,
  primary key (album_id, disk, position)
);
create index if not exists album_tracks_track_idx on album_tracks (track_id);
alter table album_tracks enable row level security;
create policy album_tracks_read on album_tracks for select using (true);
create index if not exists tracks_deezer_url_idx on tracks (deezer_url) where deezer_url is not null;
alter table deezer_albums add column if not exists tracklist_at timestamptz;

-- Save the tracklist; a tracklist-only read leaves the songs alone.
do $do$
declare d text;
begin
  d := pg_get_functiondef('sc_deezer_album_save'::regproc);
  d := replace(d, 'v_matched int := 0;', 'v_matched int := 0; v_list_only boolean;');
  d := replace(d, '  perform set_config(''static_cuts.batch_id'', sc_job_batch(''deezer'', ''Deezer releases'')::text, true);',
    '  v_list_only := al.fetched_at is not null and al.extra_at is not null and al.tracklist_at is null and al.kind in (''album'', ''ep'');
  perform set_config(''static_cuts.batch_id'', sc_job_batch(''deezer'', ''Deezer releases'')::text, true);');
  d := replace(d, '  for it in select * from jsonb_array_elements(coalesce(p_tracks, ''[]'')) loop
    continue when sc_normalize_title',
    '  for it in select * from jsonb_array_elements(coalesce(p_tracks, ''[]'')) loop
    continue when v_list_only;
    continue when sc_normalize_title');
  d := replace(d, '  update deezer_albums set fetched_at = now(), extra_at = now(), songs = v_singles, label = coalesce(v_label, label) where artist_id = p_artist and album_id = p_album;',
    '  if al.kind in (''album'', ''ep'') then
    delete from album_tracks where album_id = p_album;
    insert into album_tracks (album_id, disk, position, title, artist, duration, explicit, link, track_id)
    select p_album, coalesce(nullif(x ->> ''disk'', '''')::int, 1), coalesce(nullif(x ->> ''position'', '''')::int, ord::int),
           left(coalesce(x ->> ''title'', ''''), 300), nullif(left(coalesce(x ->> ''artist'', ''''), 200), ''''),
           nullif(x ->> ''duration'', '''')::int, (x ->> ''explicit'')::boolean, nullif(x ->> ''link'', ''''),
           coalesce((select t.id from tracks t where t.deezer_url = nullif(x ->> ''link'', '''') limit 1),
                    case when sc_normalize_title(coalesce(x ->> ''artist'', '''')) = sc_normalize_title(a.name)
                           or exists (select 1 from artist_aliases y where y.artist_id = p_artist and y.alias_key = sc_normalize_title(x ->> ''artist''))
                         then v_keys ->> sc_title_key(x ->> ''title'') end)
    from jsonb_array_elements(coalesce(p_tracks, ''[]'')) with ordinality e(x, ord)
    on conflict (album_id, disk, position) do nothing;
  end if;
  update deezer_albums set fetched_at = now(), extra_at = now(), tracklist_at = now(), songs = v_singles, label = coalesce(v_label, label) where artist_id = p_artist and album_id = p_album;');
  if position('v_list_only' in d) = 0 or position('album_tracks' in d) = 0 then raise exception 'album save patch failed'; end if;
  execute d;

  -- Lowest priority for the job: albums and EPs whose tracklist isn't saved yet.
  d := pg_get_functiondef('sc_deezer_next'::regproc);
  d := replace(d, '  return null;
end;', '  select d.artist_id, d.album_id into v_artist, v_album from deezer_albums d
  left join sc_artist_weights() w on w.artist_id = d.artist_id
  where d.kind in (''album'', ''ep'') and d.fetched_at is not null and d.tracklist_at is null
    and coalesce(d.review, '''') <> ''remove'' and (d.claimed_at is null or d.claimed_at < now() - interval ''2 minutes'')
  order by coalesce(w.weight, 0) desc, d.release_date desc nulls last
  limit 1 for update of d skip locked;
  if v_album is not null then
    update deezer_albums set claimed_at = now() where artist_id = v_artist and album_id = v_album;
    return jsonb_build_object(''kind'', ''album'', ''artist_id'', v_artist, ''album_id'', v_album);
  end if;
  return null;
end;');
  if position('tracklist_at is null' in d) = 0 then raise exception 'next patch failed'; end if;
  execute d;
end $do$;

-- An artist's official albums and EPs (Deezer), newest first, one per title.
create or replace function rpc_artist_projects(p_artist text)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  with al as (
    select distinct on (lower(d.title), d.kind) d.album_id, d.title, d.kind, d.release_date, d.cover, d.songs, d.label
    from deezer_albums d join artists a on a.id = d.artist_id
    where d.artist_id = p_artist and d.kind in ('album', 'ep')
      and coalesce(d.review, '') <> 'remove' and (d.review = 'keep' or coalesce(a.deezer_check, '') <> 'mixed')
    order by lower(d.title), d.kind, d.songs desc nulls last, d.release_date
  ),
  r as (
    select at.album_id, count(distinct s.track_id) rated, round(avg(s.avg_rating), 1) score
    from album_tracks at join track_rating_stats s on s.track_id = at.track_id
    where at.album_id in (select album_id from al) group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', al.album_id, 'title', al.title, 'kind', al.kind, 'date', al.release_date,
    'cover', al.cover, 'songs', al.songs, 'score', r.score, 'rated', coalesce(r.rated, 0)) order by al.release_date desc nulls last), '[]'::jsonb)
  from al left join r on r.album_id = al.album_id;
$$;
grant execute on function rpc_artist_projects(text) to anon, authenticated;

-- One album: details, artist, tracklist in order (with the song on the site,
-- its status and rating) and the album's score: the average of its songs'
-- average ratings, each song counted once however many people rated it.
create or replace function rpc_album(p_album text)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  with al as (
    select d.*, a.name artist_name, a.image_url artist_image from deezer_albums d join artists a on a.id = d.artist_id
    where d.album_id = p_album order by (d.review = 'keep') desc nulls last, d.songs desc nulls last limit 1
  ),
  tl as (
    select at.disk, at.position, at.title, at.artist, at.duration, at.explicit, at.track_id,
           t.title site_title, coalesce(t.release_status, case when t.is_official then 'released' else 'unconfirmed' end) status,
           t.artist_id, s.avg_rating, coalesce(s.rating_count, 0) rating_count,
           (select count(*) from tracks v where v.parent_track_id = t.id) versions
    from album_tracks at left join tracks t on t.id = at.track_id left join track_rating_stats s on s.track_id = at.track_id
    where at.album_id = p_album
  ),
  -- Before the tracklist is saved: the songs on the page filed under this album.
  fallback as (
    select null::int disk, t.track_number position, t.title, null::text artist, t.length_sec duration, t.explicit, t.id track_id,
           t.title site_title, coalesce(t.release_status, case when t.is_official then 'released' else 'unconfirmed' end) status,
           t.artist_id, s.avg_rating, coalesce(s.rating_count, 0) rating_count, 0::bigint versions
    from tracks t join al on t.artist_id = al.artist_id and lower(t.album) = lower(al.title) and t.parent_track_id is null
    left join track_rating_stats s on s.track_id = t.id
    where not exists (select 1 from tl)
  ),
  rows as (select * from tl union all select * from fallback)
  select case when not exists (select 1 from al) then null else jsonb_build_object(
    'id', (select album_id from al), 'title', (select title from al), 'kind', (select kind from al),
    'date', (select release_date from al), 'cover', (select cover from al), 'label', (select label from al),
    'link', (select link from al), 'songs', (select songs from al),
    'artist', jsonb_build_object('id', (select artist_id from al), 'name', (select artist_name from al), 'image', (select artist_image from al)),
    'complete', exists (select 1 from tl),
    'length', (select sum(duration) from rows),
    'score', (select round(avg(avg_rating), 1) from rows where avg_rating is not null),
    'rated', (select count(*) from rows where avg_rating is not null),
    'votes', (select coalesce(sum(rating_count), 0) from rows),
    'tracks', (select coalesce(jsonb_agg(to_jsonb(r) order by r.disk nulls first, r.position nulls last, r.title), '[]'::jsonb) from rows r),
    'more', (select coalesce(jsonb_agg(jsonb_build_object('id', x.album_id, 'title', x.title, 'cover', x.cover, 'date', x.release_date, 'kind', x.kind) order by x.release_date desc), '[]'::jsonb)
             from (select distinct on (lower(d.title)) d.album_id, d.title, d.cover, d.release_date, d.kind from deezer_albums d, al
                   where d.artist_id = al.artist_id and d.kind in ('album', 'ep') and d.album_id <> al.album_id and coalesce(d.review, '') <> 'remove'
                   order by lower(d.title), d.songs desc nulls last) x)
  ) end;
$$;
grant execute on function rpc_album(text) to anon, authenticated;
