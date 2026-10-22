-- Spotify import: files from exportify.net only have artist NAMES (no
-- Spotify artist IDs) and no album IDs. Songs are now matched to artists
-- here by name or nickname too, so those files work: already-here songs are
-- collected, missing songs by trusted people are added, and artists that
-- aren't here are suggested (by name). Untrusted people's songs still need
-- an album ID for our own check, so from name-only files they're collected
-- but not added.

create or replace function rpc_import_liked_songs(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user uuid := auth.uid();
  v_n int := jsonb_array_length(coalesce(p_items, '[]'));
  v_trusted boolean;
  v_batch uuid;
  v_collected int := 0;
  v_added int := 0;
  v_waiting int := 0;
  v_queued int := 0;
  v_run uuid;
  v_res jsonb;
  r record;
begin
  if v_user is null then raise exception 'Sign in first.'; end if;
  if v_n > 2000 then raise exception 'Too many songs at once.'; end if;
  if (select coalesce(sum(checked), 0) from spotify_liked_imports
      where user_id = v_user and created_at > now() - interval '1 day') + v_n > 200000 then
    raise exception 'That''s enough importing for today. Try again tomorrow.';
  end if;
  v_trusted := is_owner() or is_moderator() or sc_is_trusted(v_user);

  -- Artists here, by name and nickname, for files that only have names
  -- (exportify.net gives artist names but not Spotify artist IDs).
  create temp table if not exists _akeys (k text, artist_id text) on commit drop;
  insert into _akeys
  select sc_normalize_title(name), id from artists
  union select alias_key, artist_id from artist_aliases where alias_key is not null;
  create index if not exists _akeys_k on _akeys (k);

  create temp table if not exists _liked (url text, sid text, album_id text, grp text, artist_id text, pick_ord int, item jsonb) on commit drop;
  insert into _liked
  select 'https://open.spotify.com/track/' || x.sid, x.sid, x.album_id,
         case when x.album_type = 'album' then 'album' else 'single' end,
         p.artist_id, p.ord, i
  from jsonb_array_elements(coalesce(p_items, '[]')) i
  cross join lateral (select substring(i ->> 'spotify_url' from 'open\.spotify\.com/(?:intl-[a-z-]+/)?track/([A-Za-z0-9]{22})') sid,
                       case when i ->> 'album_id' ~ '^[A-Za-z0-9]{22}$' then i ->> 'album_id' end album_id,
                       i ->> 'album_type' album_type) x
  left join lateral (
    select m.artist_id, m.ord from (
      select a.id artist_id, ai.ord::int ord, 0 pass
      from jsonb_array_elements_text(coalesce(i -> 'artist_ids', '[]')) with ordinality ai(v, ord)
      join artists a on a.spotify_artist_id = ai.v
      union all
      select k.artist_id, an.ord::int, 1
      from jsonb_array_elements_text(coalesce(i -> 'artist_names', '[]')) with ordinality an(v, ord)
      join _akeys k on k.k = sc_normalize_title(an.v)
    ) m order by m.pass, m.ord limit 1) p on true
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
  create temp table if not exists _liked_new (url text, sid text, album_id text, grp text, artist_id text, pick_ord int, item jsonb) on commit drop;
  insert into _liked_new
  select l.* from _liked l
  where l.artist_id is not null and (l.album_id is not null or v_trusted)
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

  --   b. trusted people: add the rest straight away from their own Spotify's details
  if v_trusted then
    for r in
      select l.artist_id,
             jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'title', btrim(l.item ->> 'title'),
               'spotify_url', l.url,
               'album', case when l.item ->> 'album_type' = 'single' and coalesce((l.item ->> 'total_tracks')::int, 0) = 1
                             then null else nullif(l.item ->> 'album_name', '') end,
               'release_date', case when l.item ->> 'release_precision' = 'day'
                                     and l.item ->> 'release_date' ~ '^\d{4}-\d{2}-\d{2}$' then l.item ->> 'release_date' end,
               'track_number', case when l.item ->> 'album_type' = 'album' then l.item ->> 'track_number' end,
               'main_artist_name', case when coalesce(l.pick_ord, 1) > 1 then l.item -> 'artists' -> 0 ->> 'name' end,
               'featured', nullif(array_to_string(array(
                  select x ->> 'name' from jsonb_array_elements(coalesce(l.item -> 'artists', '[]')) with ordinality y(x, o)
                  where o > 1 and o <> coalesce(l.pick_ord, 1)
                  union all
                  select c from jsonb_array_elements_text(coalesce(l.item -> 'credits', '[]')) c), ', '), '')
             )) order by case l.grp when 'album' then 0 else 1 end) items,
             array_agg(l.url) urls
      from _liked_new l
      where coalesce(btrim(l.item ->> 'title'), '') <> ''
        and (l.album_id is null or not exists (select 1 from spotify_albums s where s.artist_id = l.artist_id and s.album_id = l.album_id and s.fetched_at is not null))
      group by l.artist_id
    loop
      insert into import_runs (artist_id, source, requested_by) values (r.artist_id, 'spotify', null) returning id into v_run;
      v_res := sc_import_add_tracks(v_run, r.items);
      update import_runs set finished_at = now() where id = v_run;
      v_added := v_added + coalesce((v_res ->> 'added')::int, 0);
      insert into track_ownership (user_id, track_id)
      select v_user, t.id from tracks t where t.spotify_url = any (r.urls)
      on conflict do nothing;
      -- No need to wait for these any more.
      delete from spotify_liked_pending where user_id = v_user and spotify_url = any (r.urls);
      delete from _liked_new where url = any (r.urls);
    end loop;
  end if;

  --   c. everyone else: queue the release and wait for our own reading of it
  with fresh as (
    select distinct on (l.artist_id, l.album_id) l.artist_id, l.album_id, l.grp from _liked_new l
    where l.album_id is not null and not exists (select 1 from spotify_albums s where s.artist_id = l.artist_id and s.album_id = l.album_id and s.fetched_at is not null)
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

-- Suggestions can come from a name only (no Spotify ID): stored as
-- "name:<the name>" and suggested without a Spotify link.
do $$
declare
  d text := pg_get_functiondef('public.rpc_suggest_library_artists(jsonb)'::regprocedure);
begin
  if position('^name:' in d) = 0 then
    d := replace(d, $q$where a ->> 'id' ~ '^[A-Za-z0-9]{22}$' and$q$, $q$where (a ->> 'id' ~ '^[A-Za-z0-9]{22}$' or a ->> 'id' ~ '^name:.+') and$q$);
    d := replace(d, $q$jsonb_build_object('name', r.name, 'spotify_artist_id', r.spotify_artist_id,$q$,
                    $q$jsonb_build_object('name', r.name, 'spotify_artist_id', case when r.spotify_artist_id ~ '^[A-Za-z0-9]{22}$' then r.spotify_artist_id end,$q$);
    if position('^name:' in d) = 0 then raise exception 'could not update rpc_suggest_library_artists'; end if;
    execute d;
  end if;
end $$;
