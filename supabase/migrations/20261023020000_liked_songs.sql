-- "Import from Spotify" in Settings now also ADDS songs from your Liked Songs
-- that aren't in the archive yet, for artists the archive already has.
--
-- The site can't take a browser's word for what's on Spotify (anyone could
-- send made-up songs), so a song is only added once our own reading of that
-- release (match-spotify, see 20261023010000_spotify_albums.sql) shows it's
-- real:
--   - release already read: added straight away, from what we read
--   - not read yet: the release jumps to the front of match-spotify's queue
--     and the song is added (and collected for you) when it's read
-- Songs already here with that Spotify link are marked collected, as before.
-- Liked songs from artists not in the archive are left alone.
-- Added songs aren't credited to anyone (like the other automatic imports),
-- so the leaderboard can't be filled by liking songs.

-- An undo batch set up by a trusted function is reused before the "who's
-- asking" check, so sc_import_add_tracks can run inside one for a listener.
-- (static_cuts.batch_id can only be set inside the database, never by a
-- request.)
create or replace function sc_begin_batch(p_kind text, p_label text default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_existing uuid := nullif(current_setting('static_cuts.batch_id', true), '')::uuid;
  v_id uuid;
  v_role text := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
begin
  if v_existing is not null and exists (select 1 from change_batches where id = v_existing) then
    return v_existing;
  end if;
  if not (is_moderator() or v_role = 'service_role' or session_user in ('postgres', 'supabase_admin')) then
    raise exception 'not authorized';
  end if;
  insert into change_batches (kind, label) values (p_kind, p_label) returning id into v_id;
  perform set_config('static_cuts.batch_id', v_id::text, true);
  delete from change_batches where created_at < now() - interval '60 days';
  return v_id;
end;
$$;

-- Liked songs waiting for their release to be read.
create table if not exists spotify_liked_pending (
  user_id uuid not null,
  artist_id text not null,
  album_id text not null,
  spotify_url text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, spotify_url)
);
create index if not exists spotify_liked_pending_album on spotify_liked_pending (artist_id, album_id);
alter table spotify_liked_pending enable row level security;
revoke all on spotify_liked_pending from anon, authenticated;

-- How much each listener has sent, for a daily limit.
create table if not exists spotify_liked_imports (
  user_id uuid not null,
  created_at timestamptz not null default now(),
  checked int not null default 0,
  added int not null default 0,
  waiting int not null default 0
);
create index if not exists spotify_liked_imports_user on spotify_liked_imports (user_id, created_at);
alter table spotify_liked_imports enable row level security;
revoke all on spotify_liked_imports from anon, authenticated;

-- Add songs we've read on a release (p_urls, null = none) for this artist,
-- then mark them collected for p_user. Returns how many were added.
create or replace function sc_spotify_add_read_songs(p_artist text, p_album text, p_urls text[], p_user uuid)
returns int
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_items jsonb;
  v_run uuid;
  v_res jsonb;
begin
  select coalesce(jsonb_agg(it), '[]') into v_items
  from spotify_albums s, jsonb_array_elements(coalesce(s.items, '[]')) it
  where s.artist_id = p_artist and s.album_id = p_album and s.fetched_at is not null
    and it ->> 'spotify_url' = any (p_urls);
  if jsonb_array_length(v_items) = 0 then return 0; end if;
  insert into import_runs (artist_id, source, requested_by) values (p_artist, 'spotify', null) returning id into v_run;
  v_res := sc_import_add_tracks(v_run, v_items);
  update import_runs set finished_at = now() where id = v_run;
  if p_user is not null then
    insert into track_ownership (user_id, track_id)
    select p_user, t.id from tracks t where t.spotify_url = any (p_urls)
    on conflict do nothing;
  end if;
  return coalesce((v_res ->> 'added')::int, 0);
end;
$$;
revoke execute on function sc_spotify_add_read_songs(text, text, text[], uuid) from public, anon, authenticated;

-- A release has just been read: add the liked songs that were waiting on it.
create or replace function sc_spotify_liked_apply(p_artist text, p_album text)
returns int
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  u record;
  v_n int := 0;
begin
  for u in select user_id, array_agg(spotify_url) urls from spotify_liked_pending
           where artist_id = p_artist and album_id = p_album group by user_id loop
    v_n := v_n + sc_spotify_add_read_songs(p_artist, p_album, u.urls, u.user_id);
  end loop;
  delete from spotify_liked_pending where artist_id = p_artist and album_id = p_album;
  return v_n;
end;
$$;
revoke execute on function sc_spotify_liked_apply(text, text) from public, anon, authenticated;

-- Called from Settings with the listener's liked songs, up to 2,000 at a
-- time: [{spotify_url, album_id, album_type, artist_ids: [...]}] straight
-- from Spotify.
create or replace function rpc_import_liked_songs(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user uuid := auth.uid();
  v_n int := jsonb_array_length(coalesce(p_items, '[]'));
  v_batch uuid;
  v_collected int := 0;
  v_added int := 0;
  v_waiting int := 0;
  v_queued int := 0;
  r record;
begin
  if v_user is null then raise exception 'Sign in first.'; end if;
  if v_n > 2000 then raise exception 'Too many songs at once.'; end if;
  if (select coalesce(sum(checked), 0) from spotify_liked_imports
      where user_id = v_user and created_at > now() - interval '1 day') + v_n > 20000 then
    raise exception 'That''s enough importing for today. Try again tomorrow.';
  end if;

  create temp table if not exists _liked (url text, sid text, album_id text, grp text, artist_id text) on commit drop;
  insert into _liked
  select 'https://open.spotify.com/track/' || x.sid, x.sid, x.album_id,
         case when x.album_type = 'album' then 'album' else 'single' end,
         (select a.id from jsonb_array_elements_text(coalesce(i -> 'artist_ids', '[]')) with ordinality ai(sid, ord)
          join artists a on a.spotify_artist_id = ai.sid order by ai.ord limit 1)
  from jsonb_array_elements(coalesce(p_items, '[]')) i,
       lateral (select substring(i ->> 'spotify_url' from 'open\.spotify\.com/(?:intl-[a-z-]+/)?track/([A-Za-z0-9]{22})') sid,
                       case when i ->> 'album_id' ~ '^[A-Za-z0-9]{22}$' then i ->> 'album_id' end album_id,
                       i ->> 'album_type' album_type) x
  where x.sid is not null and coalesce(i ->> 'album_type', '') <> 'compilation';

  -- 1. Already here: collect.
  with have as (
    select t.id, substring(t.spotify_url from 'track/([A-Za-z0-9]{22})') sid from tracks t where t.spotify_url is not null
  ), ins as (
    insert into track_ownership (user_id, track_id)
    select distinct v_user, h.id from have h join _liked l on l.sid = h.sid
    on conflict do nothing
    returning 1
  )
  select count(*) into v_collected from ins;

  -- 2. New songs for artists in the archive.
  create temp table if not exists _liked_new (url text, sid text, album_id text, grp text, artist_id text) on commit drop;
  insert into _liked_new
  select l.* from _liked l
  where l.artist_id is not null and l.album_id is not null
    and not exists (select 1 from tracks t where t.spotify_url is not null
                    and substring(t.spotify_url from 'track/([A-Za-z0-9]{22})') = l.sid);

  insert into change_batches (kind, label, created_by) values ('import', 'Liked songs from Spotify', v_user)
  returning id into v_batch;
  perform set_config('static_cuts.batch_id', v_batch::text, true);

  --   a. release already read: add from what we read (only songs really on it)
  for r in select l.artist_id, l.album_id, array_agg(l.url) urls from _liked_new l
           join spotify_albums s on s.artist_id = l.artist_id and s.album_id = l.album_id and s.fetched_at is not null
           group by l.artist_id, l.album_id loop
    v_added := v_added + sc_spotify_add_read_songs(r.artist_id, r.album_id, r.urls, v_user);
  end loop;

  --   b. not read yet: queue the release and wait (at most 300 new releases a go)
  with fresh as (
    select distinct on (l.artist_id, l.album_id) l.artist_id, l.album_id, l.grp from _liked_new l
    where not exists (select 1 from spotify_albums s where s.artist_id = l.artist_id and s.album_id = l.album_id and s.fetched_at is not null)
    limit 300
  ), q as (
    insert into spotify_albums (artist_id, album_id, grp) select artist_id, album_id, grp from fresh
    on conflict do nothing returning 1
  )
  select count(*) into v_queued from q;
  with w as (
    insert into spotify_liked_pending (user_id, artist_id, album_id, spotify_url)
    select v_user, l.artist_id, l.album_id, l.url from _liked_new l
    join spotify_albums s on s.artist_id = l.artist_id and s.album_id = l.album_id and s.fetched_at is null
    on conflict do nothing returning 1
  )
  select count(*) into v_waiting from w;

  perform set_config('static_cuts.batch_id', '', true);
  insert into spotify_liked_imports (user_id, checked, added, waiting) values (v_user, v_n, v_added, v_waiting);
  return jsonb_build_object('checked', v_n, 'collected', v_collected, 'added', v_added, 'waiting', v_waiting);
end;
$$;
revoke execute on function rpc_import_liked_songs(jsonb) from public, anon;
grant execute on function rpc_import_liked_songs(jsonb) to authenticated;

-- Releases someone is waiting on are read first.
create or replace function sc_spotify_album_next()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  with waiting as (
    select jsonb_build_object('kind', 'album', 'artist_id', a.id, 'spotify_artist_id', a.spotify_artist_id,
                              'album_id', s.album_id) j
    from spotify_albums s join artists a on a.id = s.artist_id
    where s.fetched_at is null and a.spotify_artist_id ~ '^[A-Za-z0-9]{22}$'
      and exists (select 1 from spotify_liked_pending p where p.artist_id = s.artist_id and p.album_id = s.album_id)
    order by s.listed_at
    limit 1
  ), cand as (
    select a.id, a.spotify_artist_id, a.spotify_albums_offset,
           (a.spotify_albums_offset is not null or a.spotify_albums_listed_at is null
            or a.spotify_albums_listed_at < now() - interval '30 days') as list_due,
           exists (select 1 from spotify_albums s where s.artist_id = a.id and s.fetched_at is null) as has_albums,
           exists (select 1 from import_runs r where r.artist_id = a.id and r.source = 'spotify'
                   and r.finished_at is null) as requested
    from artists a
    where a.spotify_artist_id ~ '^[A-Za-z0-9]{22}$'
  ), pick as (
    select c.* from cand c left join sc_artist_weights() w on w.artist_id = c.id
    where c.list_due or c.has_albums
    order by c.requested desc, (coalesce(w.weight, 0) > 0) desc,
             (c.spotify_albums_offset is not null or c.has_albums) desc,
             coalesce(w.weight, 0) desc, c.id
    limit 1
  )
  select coalesce((select j from waiting), case
    when p.id is null then null
    when p.list_due then jsonb_build_object('kind', 'list', 'artist_id', p.id, 'spotify_artist_id', p.spotify_artist_id,
                                            'offset', coalesce(p.spotify_albums_offset, 0))
    else (select jsonb_build_object('kind', 'album', 'artist_id', p.id, 'spotify_artist_id', p.spotify_artist_id,
                                    'album_id', s.album_id)
          from spotify_albums s where s.artist_id = p.id and s.fetched_at is null
          order by case s.grp when 'album' then 0 when 'single' then 1 else 2 end, s.album_id limit 1)
  end)
  from (select 1) one left join pick p on true;
$$;
revoke execute on function sc_spotify_album_next() from public, anon, authenticated;

-- Same as before, plus: liked songs waiting on this release are added.
create or replace function sc_spotify_album_save(p_artist text, p_album_id text, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_verified int;
  v_matched int;
  v_liked int;
begin
  update tracks set spotify_link_verified_at = now()
  where spotify_url in (select it ->> 'spotify_url' from jsonb_array_elements(coalesce(p_items, '[]')) it);
  get diagnostics v_verified = row_count;

  perform set_config('static_cuts.batch_id', sc_job_batch('spotify_match', 'Spotify matching')::text, true);
  with it as (
    select sc_title_key(i ->> 'title') k, i ->> 'spotify_url' url, nullif(i ->> 'album', '') album,
           case when i ->> 'release_date' ~ '^\d{4}-\d{2}-\d{2}$' then (i ->> 'release_date')::date end rd, n
    from jsonb_array_elements(coalesce(p_items, '[]')) with ordinality x(i, n)
    where i ->> 'spotify_url' like 'https://open.spotify.com/track/%'
      and not exists (select 1 from tracks x where x.spotify_url = i ->> 'spotify_url')
  ), mine as (
    select t.id, t.title from tracks t where t.artist_id = p_artist and t.spotify_url is null and t.parent_track_id is null
    union
    select t.id, t.title from track_appearances ap join tracks t on t.id = ap.track_id
    where ap.artist_id = p_artist and t.spotify_url is null and t.parent_track_id is null
  ), m as (
    select distinct on (mine.id) mine.id, it.url, it.album, it.rd
    from mine join it on it.k = sc_title_key(mine.title)
    where it.k <> ''
    order by mine.id, it.n
  )
  update tracks t set
    spotify_url = m.url,
    release_status = case when t.release_status = 'removed' then t.release_status else 'released' end,
    album = coalesce(t.album, m.album),
    release_date = coalesce(t.release_date, m.rd),
    spotify_search_attempted_at = now(),
    spotify_link_verified_at = now()
  from m where t.id = m.id;
  get diagnostics v_matched = row_count;
  perform set_config('static_cuts.batch_id', '', true);

  update spotify_albums set items = coalesce(p_items, '[]'), fetched_at = now()
  where artist_id = p_artist and album_id = p_album_id;
  v_liked := sc_spotify_liked_apply(p_artist, p_album_id);
  return jsonb_build_object('matched', v_matched, 'verified', v_verified, 'liked_added', v_liked,
                            'import', sc_spotify_album_try_finish(p_artist));
end;
$$;
revoke execute on function sc_spotify_album_save(text, text, jsonb) from public, anon, authenticated;
