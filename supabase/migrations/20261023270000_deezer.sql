-- Deezer reads artists' releases (Spotify allows us 25 calls an hour; Deezer's
-- public catalogue needs no sign-in and allows far more). A timer
-- (deezer-sync, every 2 minutes) works through artists one at a time,
-- followed artists first:
--   1. find the artist on Deezer (a name search; only an exact name match is
--      taken, and when several share the name, only a clear favourite by fans)
--   2. list their albums, EPs and singles (not compilations)
--   3. read each release's songs: songs already on the page get the album,
--      date, track number, cover and a Deezer link filled in and count as
--      released; songs not on the page are added as released (not for
--      artists whose catalogue is on hold).
-- Releases are re-listed monthly. Every call takes a 'deezer' ticket.
-- Changes go in the "Deezer releases" undo batch.

alter table artists add column if not exists deezer_artist_id text;
alter table artists add column if not exists deezer_lookup_at timestamptz;
alter table artists add column if not exists deezer_listed_at timestamptz;
alter table artists add column if not exists deezer_list_index int;
create unique index if not exists artists_deezer_artist_id_key on artists (deezer_artist_id) where deezer_artist_id is not null;
alter table tracks add column if not exists deezer_url text;

create table if not exists deezer_albums (
  artist_id text not null references artists(id) on delete cascade,
  album_id text not null,
  kind text not null,
  title text,
  release_date date,
  cover text,
  link text,
  fetched_at timestamptz,
  songs int,
  primary key (artist_id, album_id)
);
create index if not exists deezer_albums_todo on deezer_albums (artist_id) where fetched_at is null;
alter table deezer_albums enable row level security;
revoke all on deezer_albums from anon, authenticated;

insert into sc_private_settings (key, value) values ('deezer_per_minute', '30'), ('deezer_per_day', '20000')
on conflict (key) do nothing;

create or replace function sc_deezer_secret_ok(p_secret text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select p_secret is not null and p_secret = (select value from sc_private_settings where key = 'cron_secret');
$$;
revoke execute on function sc_deezer_secret_ok(text) from public, anon, authenticated;

-- The next piece of work.
create or replace function sc_deezer_next(p_secret text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v jsonb;
begin
  if not sc_deezer_secret_ok(p_secret) then raise exception 'not authorized'; end if;
  -- Finish an artist before starting another: unread releases first.
  select jsonb_build_object('kind', 'album', 'artist_id', d.artist_id, 'album_id', d.album_id) into v
  from deezer_albums d join artists a on a.id = d.artist_id
  left join sc_artist_weights() w on w.artist_id = d.artist_id
  where d.fetched_at is null and a.deezer_list_index is null
  order by coalesce(w.weight, 0) desc, d.artist_id,
           case d.kind when 'album' then 0 when 'ep' then 1 else 2 end, d.release_date nulls last, d.album_id
  limit 1;
  if v is not null then return v; end if;

  select case when a.deezer_artist_id is null
              then jsonb_build_object('kind', 'search', 'artist_id', a.id, 'name', a.name)
              else jsonb_build_object('kind', 'list', 'artist_id', a.id, 'deezer_id', a.deezer_artist_id, 'index', coalesce(a.deezer_list_index, 0)) end
  into v
  from artists a
  left join sc_artist_weights() w on w.artist_id = a.id
  left join artist_track_counts c on c.artist_id = a.id
  where (a.deezer_artist_id is null and (a.deezer_lookup_at is null or a.deezer_lookup_at < now() - interval '60 days'))
     or (a.deezer_artist_id is not null and (a.deezer_list_index is not null or a.deezer_listed_at is null
                                             or a.deezer_listed_at < now() - interval '30 days'))
  order by a.deezer_list_index is not null desc, coalesce(w.weight, 0) desc,
           (a.deezer_artist_id is not null) desc, coalesce(c.n, 0) desc, a.id
  limit 1;
  return v;
end;
$$;
revoke execute on function sc_deezer_next(text) from public, anon, authenticated;

create or replace function sc_deezer_link(p_secret text, p_artist text, p_deezer_id text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not sc_deezer_secret_ok(p_secret) then raise exception 'not authorized'; end if;
  update artists set deezer_lookup_at = now(),
    deezer_artist_id = case when p_deezer_id ~ '^\d+$' and not exists (select 1 from artists o where o.deezer_artist_id = p_deezer_id)
                            then p_deezer_id else deezer_artist_id end
  where id = p_artist;
end;
$$;
revoke execute on function sc_deezer_link(text, text, text) from public, anon, authenticated;

-- One page of releases: [{id, title, kind, release_date, cover, link}].
create or replace function sc_deezer_listed(p_secret text, p_artist text, p_albums jsonb, p_next int)
returns int
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  n int;
begin
  if not sc_deezer_secret_ok(p_secret) then raise exception 'not authorized'; end if;
  insert into deezer_albums (artist_id, album_id, kind, title, release_date, cover, link)
  select p_artist, a ->> 'id', a ->> 'kind', left(a ->> 'title', 300),
         case when a ->> 'release_date' ~ '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$' then (a ->> 'release_date')::date end,
         a ->> 'cover', a ->> 'link'
  from jsonb_array_elements(coalesce(p_albums, '[]')) a
  where a ->> 'id' ~ '^\d+$' and a ->> 'kind' in ('album', 'ep', 'single')
  on conflict (artist_id, album_id) do nothing;
  get diagnostics n = row_count;
  update artists set deezer_list_index = p_next,
                     deezer_listed_at = case when p_next is null then now() else deezer_listed_at end
  where id = p_artist;
  return n;
end;
$$;
revoke execute on function sc_deezer_listed(text, text, jsonb, int) from public, anon, authenticated;

-- One release's songs: [{title, position, disk, link, artist}].
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
  v_known record;
  v_id text;
  v_album text;
  v_add boolean;
  v_matched int := 0;
  v_added int := 0;
  v_singles int;
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

  create temp table if not exists _dz_known (k text, track_id text, spotify_url text, album text, release_date date) on commit drop;
  truncate _dz_known;
  insert into _dz_known select * from sc_known_keys(p_artist);

  for it in select * from jsonb_array_elements(coalesce(p_tracks, '[]')) loop
    -- Songs where this artist isn't the main artist are left out.
    continue when sc_normalize_title(coalesce(it ->> 'artist', '')) <> sc_normalize_title(a.name)
              and not exists (select 1 from artist_aliases x where x.artist_id = p_artist and x.alias_key = sc_normalize_title(it ->> 'artist'));
    v_key := sc_title_key(it ->> 'title');
    continue when v_key is null or v_key = '';
    select * into v_known from _dz_known where k = v_key limit 1;
    if v_known.track_id is not null then
      update tracks t set
        deezer_url = coalesce(t.deezer_url, nullif(it ->> 'link', '')),
        album = coalesce(t.album, v_album),
        release_date = coalesce(t.release_date, al.release_date),
        track_number = coalesce(t.track_number, case when al.kind <> 'single' then nullif(it ->> 'position', '')::int end),
        cover_url = coalesce(t.cover_url, al.cover),
        release_status = case when coalesce(t.release_status, 'unconfirmed') in ('unconfirmed', 'leaked', 'snippet', 'teased', 'announced', 'rumored')
                              then 'released' else t.release_status end
      where t.id = v_known.track_id
        and (t.deezer_url is null or t.album is null or t.release_date is null or t.cover_url is null
             or coalesce(t.release_status, 'unconfirmed') in ('unconfirmed', 'leaked', 'snippet', 'teased', 'announced', 'rumored'));
      if found then v_matched := v_matched + 1; end if;
      continue;
    end if;
    continue when not v_add;
    v_id := p_artist || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
    insert into tracks (id, artist_id, title, release_status, album, release_date, track_number, cover_url,
                        deezer_url, source, source_url)
    values (v_id, p_artist, left(it ->> 'title', 300), 'released', v_album, al.release_date,
            case when al.kind <> 'single' then nullif(it ->> 'position', '')::int end, al.cover,
            nullif(it ->> 'link', ''), 'deezer', coalesce(nullif(it ->> 'link', ''), al.link));
    insert into _dz_known (k, track_id) values (v_key, v_id);
    v_added := v_added + 1;
  end loop;

  update deezer_albums set fetched_at = now(), songs = v_singles where artist_id = p_artist and album_id = p_album;
  perform set_config('static_cuts.batch_id', '', true);
  return jsonb_build_object('matched', v_matched, 'added', v_added);
end;
$$;
revoke execute on function sc_deezer_album_save(text, text, text, jsonb) from public, anon, authenticated;

-- Song pages show the Deezer link too.
do $$
declare
  d text := pg_get_functiondef('public.rpc_song_page(text)'::regprocedure);
begin
  if position('''deezer_url''' in d) = 0 then
    d := replace(d, $q$'spotify_url', t.spotify_url,$q$, $q$'spotify_url', t.spotify_url, 'deezer_url', t.deezer_url,$q$);
    if position('''deezer_url''' in d) = 0 then raise exception 'could not update rpc_song_page'; end if;
    execute d;
  end if;
end $$;

select cron.schedule('deezer-sync', '*/2 * * * *', $cron$
  select net.http_post(
    url := 'https://pcuyzaamcsegblrauxsa.supabase.co/functions/v1/deezer-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select value from public.sc_private_settings where key = 'cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000);
$cron$);
