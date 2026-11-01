-- Save more of what the jobs already receive (no extra calls, except one
-- per Deezer release for its label):
--  Genius:      songwriters, samples / sampled in / interpolations / remix
--               and cover relations, album name (if empty), full-size art
--               instead of the 300px thumbnail
--  Deezer:      ISRC (the recording's official code), explicit flag, label
--  MusicBrainz: official links (Instagram, website, Wikipedia...), country,
--               real name, active years
--  Apple:       release date, genre and explicit flag where we have none
-- Songs already checked are revisited slowly, after new work, to fill these.

alter table tracks add column if not exists isrc text;
alter table tracks add column if not exists explicit boolean;
alter table tracks add column if not exists label text;
alter table tracks add column if not exists writers text;
alter table tracks add column if not exists genius_extra_at timestamptz;
create index if not exists tracks_isrc_idx on tracks (isrc) where isrc is not null;
create index if not exists tracks_genius_extra_idx on tracks (id) where genius_song_id is not null and genius_extra_at is null;

alter table deezer_albums add column if not exists extra_at timestamptz;
alter table deezer_albums add column if not exists label text;
create index if not exists deezer_albums_extra_idx on deezer_albums (artist_id) where extra_at is null and fetched_at is not null;

alter table artists add column if not exists links jsonb;
alter table artists add column if not exists country text;
alter table artists add column if not exists real_name text;
alter table artists add column if not exists active_from integer;
alter table artists add column if not exists active_to integer;

-- Song to song relations from Genius: "samples", "sampled_in",
-- "interpolates", "interpolated_by", "remix_of", "remixed_by", "cover_of",
-- "covered_by". other_track_id is filled when that song is here.
create table if not exists track_relations (
  track_id text not null,
  kind text not null,
  other_genius_id bigint not null,
  other_title text not null,
  other_artist text,
  other_url text,
  primary key (track_id, kind, other_genius_id)
);
create index if not exists track_relations_other_idx on track_relations (other_genius_id);
alter table track_relations enable row level security;
revoke all on track_relations from anon, authenticated;

-- ---------------------------------------------------------------- Genius
create or replace function sc_genius_credit_save(p_secret text, p_items jsonb)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  it jsonb;
  n int := 0;
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then
    raise exception 'not authorized';
  end if;
  perform set_config('static_cuts.skip_status_log', 'on', true);
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    update tracks set
      genius_checked_at = now(),
      genius_extra_at = case when it ? 'writers' then now() else genius_extra_at end,
      genius_song_id = coalesce(genius_song_id, nullif(it ->> 'genius_song_id', '')::bigint),
      producers = coalesce(producers, nullif(it ->> 'producers', '')),
      featured_artists = coalesce(nullif(featured_artists, ''), nullif(it ->> 'featuring', '')),
      writers = coalesce(writers, nullif(it ->> 'writers', '')),
      album = case when album is null and release_status = 'released' then nullif(it ->> 'album', '') else album end,
      release_date = case when release_date is null and release_status = 'released'
                          then nullif(it ->> 'release_date', '')::date else release_date end,
      -- Full-size art replaces our own 300px Genius thumbnail.
      cover_url = case when cover_url is null or cover_url ~ '^https://images\.genius\.com/.*\.300x300x\d\.'
                       then coalesce(nullif(it ->> 'cover_url', ''), cover_url) else cover_url end
    where id = it ->> 'track_id';
    insert into track_relations (track_id, kind, other_genius_id, other_title, other_artist, other_url)
    select it ->> 'track_id', r ->> 'kind', (r ->> 'id')::bigint, left(r ->> 'title', 300), left(r ->> 'artist', 200), r ->> 'url'
    from jsonb_array_elements(coalesce(it -> 'relations', '[]'::jsonb)) r
    where coalesce(r ->> 'id', '') ~ '^\d+$' and coalesce(r ->> 'title', '') <> ''
    on conflict (track_id, kind, other_genius_id) do nothing;
    if nullif(it ->> 'genius_song_id', '') is not null then n := n + 1; end if;
  end loop;
  return n;
end;
$$;

-- Picker: as before, then (when there's nothing new) songs matched to
-- Genius before 1 Nov that haven't had writers/samples read yet.
create or replace function sc_genius_credit_next(p_secret text, p_limit integer default 15)
returns table(track_id text, title text, artist text, genius_artist_id text, genius_song_id bigint)
language plpgsql
security definer
set search_path to 'public'
set work_mem to '32MB'
as $$
declare
  v_limit int := greatest(1, least(coalesce(p_limit, 15), 400));
  v_left int;
  n int;
  a record;
  pass int;
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then
    raise exception 'not authorized';
  end if;

  -- Songs already matched to a Genius song (just need its details) first.
  return query
  select t.id, t.title, ar.name, ar.genius_artist_id, t.genius_song_id
  from tracks t
  join artists ar on ar.id = t.artist_id
  left join sc_artist_weights() w on w.artist_id = t.artist_id
  where t.genius_checked_at is null and t.genius_song_id is not null
    and (t.producers is null or t.featured_artists is null or t.cover_url is null)
  order by coalesce(w.weight, 0) desc, (t.parent_track_id is not null), (t.release_status in ('released', 'leaked')) desc, t.id
  limit v_limit;
  get diagnostics n = row_count;
  v_left := v_limit - n;

  -- Then by artist (most followed first): pass 1 only released main songs
  -- that are on Spotify/Deezer/Apple (Genius nearly always has those; tracker
  -- "released" rows like mixtape tapes and bonus CDs it usually doesn't);
  -- pass 2 the rest.
  for pass in 1..2 loop
    exit when v_left <= 0;
    for a in
      select ar.id, ar.name, ar.genius_artist_id
      from artists ar left join sc_artist_weights() w on w.artist_id = ar.id
      order by coalesce(w.weight, 0) desc, ar.id
    loop
      return query
      select t.id, t.title, a.name, a.genius_artist_id, t.genius_song_id
      from tracks t
      where t.artist_id = a.id and t.genius_checked_at is null and t.genius_song_id is null
        and (t.producers is null or t.featured_artists is null or t.cover_url is null)
        and (pass = 2 or (t.parent_track_id is null and t.release_status = 'released'
                          and (t.spotify_url is not null or t.deezer_url is not null or t.apple_url is not null)))
      order by (t.parent_track_id is not null), (t.release_status in ('released', 'leaked')) desc, t.id
      limit v_left;
      get diagnostics n = row_count;
      v_left := v_left - n;
      exit when v_left <= 0;
    end loop;
  end loop;

  -- Songs matched before writers/samples were saved: one call each.
  if v_left > 0 then
    return query
    select t.id, t.title, ar.name, ar.genius_artist_id, t.genius_song_id
    from tracks t join artists ar on ar.id = t.artist_id
    where t.genius_song_id is not null and t.genius_extra_at is null
    order by t.id
    limit v_left;
    get diagnostics n = row_count;
    v_left := v_left - n;
  end if;

  -- Nothing new: re-check songs last checked over 60 days ago.
  if v_left = v_limit then
    return query
    select t.id, t.title, ar.name, ar.genius_artist_id, t.genius_song_id
    from tracks t join artists ar on ar.id = t.artist_id
    where t.genius_checked_at < now() - interval '60 days'
      and (t.producers is null or t.featured_artists is null or t.cover_url is null)
    order by t.genius_checked_at
    limit v_limit;
  end if;
end;
$$;

-- A song's relations for its page, linked to songs here where we have them.
create or replace function rpc_track_relations(p_track text)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'kind', r.kind, 'title', r.other_title, 'artist', r.other_artist, 'url', r.other_url,
    'track_id', (select t.id from tracks t where t.genius_song_id = r.other_genius_id order by t.parent_track_id is not null, t.id limit 1))
    order by r.kind, r.other_title), '[]'::jsonb)
  from (
    select kind, other_genius_id, other_title, other_artist, other_url from track_relations where track_id = p_track
    union
    -- The other direction: songs here that say they sample this one.
    select case r.kind when 'samples' then 'sampled_in' when 'interpolates' then 'interpolated_by'
                       when 'remix_of' then 'remixed_by' when 'cover_of' then 'covered_by' end,
           o.genius_song_id, o.title, a.name, null
    from tracks me
    join track_relations r on r.other_genius_id = me.genius_song_id
    join tracks o on o.id = r.track_id
    join artists a on a.id = o.artist_id
    where me.id = p_track and me.genius_song_id is not null and o.genius_song_id is not null
      and r.kind in ('samples', 'interpolates', 'remix_of', 'cover_of')
  ) r;
$$;
grant execute on function rpc_track_relations(text) to anon, authenticated;

-- ---------------------------------------------------------------- Deezer
-- Album save: also ISRC, explicit and the release's label. A release read
-- before 1 Nov is read once more (after all new work) to fill these.
create or replace function sc_deezer_album_save(p_secret text, p_artist text, p_album text, p_tracks jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  al deezer_albums%rowtype;
  a artists%rowtype;
  it jsonb;
  v_key text;
  v_id text;
  v_album text;
  v_add boolean;
  v_matched int := 0;
  v_added int := 0;
  v_singles int;
  v_label text;
  v_keys jsonb;
  v_track text;
begin
  if not sc_deezer_secret_ok(p_secret) then raise exception 'not authorized'; end if;
  select * into al from deezer_albums where artist_id = p_artist and album_id = p_album;
  select * into a from artists where id = p_artist;
  if al.album_id is null or a.id is null then return null; end if;

  perform set_config('static_cuts.batch_id', sc_job_batch('deezer', 'Deezer releases')::text, true);
  perform set_config('static_cuts.skip_status_log', 'on', true);
  v_add := not a.catalogue_hold;
  v_singles := jsonb_array_length(coalesce(p_tracks, '[]'));
  -- A one-song single's "album" is just the song.
  v_album := case when al.kind = 'single' and v_singles <= 1 then null else al.title end;
  v_label := nullif(left(coalesce(p_tracks -> 0 ->> 'label', ''), 200), '');
  -- Every title this artist already has (own songs, features, nicknames),
  -- read once per release.
  select coalesce(jsonb_object_agg(k, track_id), '{}'::jsonb) into v_keys
  from (select distinct on (k) k, track_id from sc_known_keys(p_artist) where coalesce(k, '') <> '' order by k, track_id) x;

  for it in select * from jsonb_array_elements(coalesce(p_tracks, '[]')) loop
    -- Songs where this artist isn't the main artist are left out.
    continue when sc_normalize_title(coalesce(it ->> 'artist', '')) <> sc_normalize_title(a.name)
              and not exists (select 1 from artist_aliases x where x.artist_id = p_artist and x.alias_key = sc_normalize_title(it ->> 'artist'));
    v_key := sc_title_key(it ->> 'title');
    continue when v_key is null or v_key = '';
    v_track := v_keys ->> v_key;
    if v_track is not null then
      update tracks t set
        deezer_url = coalesce(t.deezer_url, nullif(it ->> 'link', '')),
        album = coalesce(t.album, v_album),
        release_date = coalesce(t.release_date, al.release_date),
        track_number = coalesce(t.track_number, case when al.kind <> 'single' then nullif(it ->> 'position', '')::int end),
        cover_url = coalesce(t.cover_url, al.cover),
        length_sec = coalesce(t.length_sec, nullif(it ->> 'duration', '')::int),
        isrc = coalesce(t.isrc, nullif(it ->> 'isrc', '')),
        explicit = coalesce(t.explicit, (it ->> 'explicit')::boolean),
        label = coalesce(t.label, v_label),
        release_status = case when coalesce(t.release_status, 'unconfirmed') in ('unconfirmed', 'leaked', 'snippet', 'teased', 'announced', 'rumored')
                              then 'released' else t.release_status end
      where t.id = v_track
        and (t.deezer_url is null or t.album is null or t.release_date is null or t.cover_url is null
             or (t.length_sec is null and nullif(it ->> 'duration', '') is not null)
             or (t.isrc is null and nullif(it ->> 'isrc', '') is not null)
             or (t.explicit is null and it ? 'explicit')
             or (t.label is null and v_label is not null)
             or coalesce(t.release_status, 'unconfirmed') in ('unconfirmed', 'leaked', 'snippet', 'teased', 'announced', 'rumored'));
      if found then v_matched := v_matched + 1; end if;
      continue;
    end if;
    -- New songs only on a release's first read (not the 1 Nov extra-info re-read).
    continue when not v_add or al.fetched_at is not null;
    v_id := p_artist || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
    insert into tracks (id, artist_id, title, release_status, album, release_date, track_number, cover_url,
                        deezer_url, source, source_url, length_sec, isrc, explicit, label)
    values (v_id, p_artist, left(it ->> 'title', 300), 'released', v_album, al.release_date,
            case when al.kind <> 'single' then nullif(it ->> 'position', '')::int end, al.cover,
            nullif(it ->> 'link', ''), 'deezer', coalesce(nullif(it ->> 'link', ''), al.link), nullif(it ->> 'duration', '')::int,
            nullif(it ->> 'isrc', ''), (it ->> 'explicit')::boolean, v_label);
    v_keys := v_keys || jsonb_build_object(v_key, v_id);
    v_added := v_added + 1;
  end loop;

  update deezer_albums set fetched_at = now(), extra_at = now(), songs = v_singles, label = coalesce(v_label, label)
  where artist_id = p_artist and album_id = p_album;
  perform set_config('static_cuts.batch_id', '', true);
  return jsonb_build_object('matched', v_matched, 'added', v_added);
end;
$$;

-- Deezer picker: as before; when there's nothing else, a release read
-- before 1 Nov is read again for its ISRC, explicit flag and label.
create or replace function sc_deezer_next(p_secret text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v jsonb;
  v_artist text;
  v_album text;
begin
  if not sc_deezer_secret_ok(p_secret) then raise exception 'not authorized'; end if;
  -- Finish an artist before starting another: unread releases first. Pick
  -- the artist (931 rows), then their next release.
  select a.id into v_artist
  from artists a left join sc_artist_weights() w on w.artist_id = a.id
  where a.deezer_list_index is null
    and exists (select 1 from deezer_albums d where d.artist_id = a.id and d.fetched_at is null
                and (d.claimed_at is null or d.claimed_at < now() - interval '2 minutes'))
  order by coalesce(w.weight, 0) desc, a.id
  limit 1;
  if v_artist is not null then
    select d.album_id into v_album
    from deezer_albums d
    where d.artist_id = v_artist and d.fetched_at is null
      and (d.claimed_at is null or d.claimed_at < now() - interval '2 minutes')
    order by case d.kind when 'album' then 0 when 'ep' then 1 else 2 end, d.release_date nulls last, d.album_id
    limit 1
    for update of d skip locked;
  end if;
  if v_album is not null then
    update deezer_albums set claimed_at = now() where artist_id = v_artist and album_id = v_album;
    return jsonb_build_object('kind', 'album', 'artist_id', v_artist, 'album_id', v_album);
  end if;

  -- Photos for artists found on Deezer who still have none (one call each).
  v_artist := null;
  select a.id into v_artist
  from artists a
  where a.deezer_artist_id is not null and a.image_url is null and a.deezer_photo_at is null
    and (a.deezer_claim_at is null or a.deezer_claim_at < now() - interval '2 minutes')
  order by a.id
  limit 1
  for update of a skip locked;
  if v_artist is not null then
    update artists set deezer_claim_at = now() where id = v_artist;
    return (select jsonb_build_object('kind', 'photo', 'artist_id', id, 'deezer_id', deezer_artist_id) from artists where id = v_artist);
  end if;

  select case when a.deezer_artist_id is null
              then jsonb_build_object('kind', 'search', 'artist_id', a.id, 'name', a.name)
              else jsonb_build_object('kind', 'list', 'artist_id', a.id, 'deezer_id', a.deezer_artist_id, 'index', coalesce(a.deezer_list_index, 0)) end,
         a.id
  into v, v_artist
  from artists a
  left join sc_artist_weights() w on w.artist_id = a.id
  left join artist_track_counts c on c.artist_id = a.id
  where ((a.deezer_artist_id is null and (a.deezer_lookup_at is null or a.deezer_lookup_at < now() - interval '60 days'))
      or (a.deezer_artist_id is not null and (a.deezer_list_index is not null or a.deezer_listed_at is null
                                              or a.deezer_listed_at < now() - interval '7 days')))
    and (a.deezer_claim_at is null or a.deezer_claim_at < now() - interval '2 minutes')
  order by a.deezer_list_index is not null desc, coalesce(w.weight, 0) desc,
           (a.deezer_artist_id is not null) desc, coalesce(c.n, 0) desc, a.id
  limit 1
  for update of a skip locked;
  if v_artist is not null then
    update artists set deezer_claim_at = now() where id = v_artist;
    return v;
  end if;

  -- Nothing else to do: re-read an older release for its extra info.
  select d.artist_id, d.album_id into v_artist, v_album
  from deezer_albums d
  where d.extra_at is null and d.fetched_at is not null
    and (d.claimed_at is null or d.claimed_at < now() - interval '2 minutes')
  limit 1
  for update skip locked;
  if v_album is not null then
    update deezer_albums set claimed_at = now() where artist_id = v_artist and album_id = v_album;
    return jsonb_build_object('kind', 'album', 'artist_id', v_artist, 'album_id', v_album);
  end if;
  return null;
end;
$$;

-- ------------------------------------------------------------ MusicBrainz
-- p_info: {mbid, links: [{type, url}], country, real_name, from, to}; saved
-- only when the artist's MusicBrainz match (mbid) was kept.
create or replace function sc_mb_info(p_secret text, p_artist text, p_info jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then
    raise exception 'not authorized';
  end if;
  update artists set
    links = case when jsonb_array_length(coalesce(p_info -> 'links', '[]'::jsonb)) > 0 then p_info -> 'links' else links end,
    country = coalesce(nullif(p_info ->> 'country', ''), country),
    real_name = coalesce(nullif(p_info ->> 'real_name', ''), real_name),
    active_from = coalesce(nullif(p_info ->> 'from', '')::int, active_from),
    active_to = case when p_info ? 'to' then nullif(p_info ->> 'to', '')::int else active_to end
  where id = p_artist and musicbrainz_id = p_info ->> 'mbid';
end;
$$;
revoke execute on function sc_mb_info(text, text, jsonb) from public, anon, authenticated;

-- ------------------------------------------------------------------ Apple
-- Items: {title, url, released, explicit, genre}
create or replace function sc_apple_album_save(p_secret text, p_artist text, p_album text, p_tracks jsonb)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_n int;
begin
  if not sc_apple_secret_ok(p_secret) then raise exception 'not authorized'; end if;
  perform set_config('static_cuts.batch_id', sc_job_batch('apple', 'Apple Music links')::text, true);
  perform set_config('static_cuts.skip_status_log', 'on', true);
  -- Match each Apple song to the page by its saved title key (indexed),
  -- one song per title: the main song rather than a copy or version.
  update tracks t set
    apple_url = coalesce(t.apple_url, m.url),
    release_date = case when t.release_date is null and t.release_status = 'released' then m.released else t.release_date end,
    explicit = coalesce(t.explicit, m.explicit),
    genre = coalesce(t.genre, m.genre)
  from (
    select distinct on (x.k) tk.track_id, x.url, x.released, x.explicit, x.genre
    from (select sc_title_key(e ->> 'title') k, e ->> 'url' url,
                 case when e ->> 'released' ~ '^\d{4}-\d{2}-\d{2}' then left(e ->> 'released', 10)::date end released,
                 (e ->> 'explicit')::boolean explicit, nullif(left(e ->> 'genre', 60), '') genre
          from jsonb_array_elements(coalesce(p_tracks, '[]'::jsonb)) e
          where coalesce(e ->> 'url', '') ~ '^https://music\.apple\.com/') x
    join track_title_keys tk on tk.key = x.k and tk.artist_id = p_artist
    join tracks tt on tt.id = tk.track_id
    where coalesce(x.k, '') <> ''
    order by x.k, tt.parent_track_id is not null, tt.spotify_url is null, tt.id
  ) m
  where t.id = m.track_id
    and (t.apple_url is null or (t.release_date is null and t.release_status = 'released' and m.released is not null)
         or (t.explicit is null and m.explicit is not null) or (t.genre is null and m.genre is not null));
  get diagnostics v_n = row_count;
  update apple_albums set fetched_at = now(), claimed_at = null where artist_id = p_artist and album_id = p_album;
  perform set_config('static_cuts.batch_id', '', true);
  return v_n;
end;
$$;
revoke execute on function sc_apple_album_save(text, text, text, jsonb) from public, anon, authenticated;

-- ------------------------------------------------------------- Song page
do $$
declare
  d text := pg_get_functiondef((select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                where n.nspname = 'public' and p.proname = 'rpc_song_page' limit 1));
begin
  if position('''writers''' in d) = 0 then
    if position('''apple_url'', t.apple_url,' in d) = 0 then raise exception 'could not update rpc_song_page'; end if;
    execute replace(d, '''apple_url'', t.apple_url,',
      '''apple_url'', t.apple_url, ''writers'', t.writers, ''label'', t.label, ''isrc'', t.isrc, ''explicit'', t.explicit,');
  end if;
end $$;

-- Artists already looked up get looked up again (cheap) for the new info.
update artists set mb_checked_at = null where musicbrainz_id is not null and musicbrainz_id <> 'none' and links is null;
