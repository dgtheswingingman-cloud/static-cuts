-- Apple Music links on songs, so Apple users can play them too. A
-- background job (apple-music, every minute, ~15 requests a run) reads each
-- artist's releases from Apple's free iTunes Search API and adds the Apple
-- Music link to songs already here. Nothing else is changed or added.
--
-- Finding the artist: exact-name artists on Apple, kept only when one of
-- their releases matches an album or song already on the page (so a
-- same-named stranger isn't used). Releases are re-read every 2 weeks.

alter table tracks add column if not exists apple_url text;
alter table artists add column if not exists apple_artist_id text;
alter table artists add column if not exists apple_checked_at timestamptz;
alter table artists add column if not exists apple_claim_at timestamptz;

create table if not exists apple_albums (
  artist_id text not null,
  album_id text not null,
  title text not null,
  fetched_at timestamptz,
  claimed_at timestamptz,
  primary key (artist_id, album_id)
);
create index if not exists apple_albums_todo on apple_albums (artist_id) where fetched_at is null;
alter table apple_albums enable row level security;
revoke all on apple_albums from anon, authenticated;

insert into sc_private_settings (key, value) values ('itunes_per_minute', '18'), ('itunes_per_day', '25000')
on conflict (key) do nothing;

create or replace function sc_apple_secret_ok(p_secret text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select p_secret is not null and p_secret = (select value from sc_private_settings where key = 'cron_secret');
$$;

-- Next piece of work: an unread release first, else an artist to (re)list.
create or replace function sc_apple_next(p_secret text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_artist text;
  v_album text;
  v record;
begin
  if not sc_apple_secret_ok(p_secret) then raise exception 'not authorized'; end if;
  select al.artist_id, al.album_id into v_artist, v_album
  from apple_albums al
  where al.fetched_at is null and (al.claimed_at is null or al.claimed_at < now() - interval '2 minutes')
  order by al.artist_id, al.album_id
  limit 1
  for update skip locked;
  if v_album is not null then
    update apple_albums set claimed_at = now() where artist_id = v_artist and album_id = v_album;
    return jsonb_build_object('kind', 'album', 'artist_id', v_artist, 'album_id', v_album);
  end if;

  select a.id, a.name, a.apple_artist_id into v
  from artists a left join sc_artist_weights() w on w.artist_id = a.id
  where (a.apple_checked_at is null
         or (a.apple_artist_id is distinct from 'none' and a.apple_checked_at < now() - interval '14 days')
         or (a.apple_artist_id = 'none' and a.apple_checked_at < now() - interval '30 days'))
    and (a.apple_claim_at is null or a.apple_claim_at < now() - interval '5 minutes')
  order by a.apple_checked_at nulls first, coalesce(w.weight, 0) desc, a.id
  limit 1
  for update of a skip locked;
  if v.id is null then return null; end if;
  update artists set apple_claim_at = now() where id = v.id;
  return jsonb_build_object('kind', 'artist', 'artist_id', v.id, 'name', v.name,
    'apple_id', case when v.apple_artist_id <> 'none' then v.apple_artist_id end);
end;
$$;

-- Try one Apple artist for this page: kept when any of their releases
-- shares a title with an album or song here. Returns whether it was kept.
-- p_albums: [{id, title}]
create or replace function sc_apple_artist_try(p_secret text, p_artist text, p_apple_id text, p_albums jsonb)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not sc_apple_secret_ok(p_secret) then raise exception 'not authorized'; end if;
  if not exists (
    select 1
    from jsonb_array_elements(coalesce(p_albums, '[]'::jsonb)) x
    join (select sc_title_key(album) k from tracks where artist_id = p_artist and album is not null
          union select k from sc_known_keys(p_artist)) mine
      on mine.k = sc_title_key(x ->> 'title')
    where coalesce(sc_title_key(x ->> 'title'), '') <> ''
  ) then
    return false;
  end if;
  update artists set apple_artist_id = p_apple_id, apple_checked_at = now(), apple_claim_at = null where id = p_artist;
  insert into apple_albums (artist_id, album_id, title)
  select p_artist, x ->> 'id', left(x ->> 'title', 300)
  from jsonb_array_elements(coalesce(p_albums, '[]'::jsonb)) x
  where coalesce(x ->> 'id', '') <> '' and coalesce(x ->> 'title', '') <> ''
  on conflict (artist_id, album_id) do nothing;
  return true;
end;
$$;

-- No Apple artist matched: try again in a month.
create or replace function sc_apple_artist_none(p_secret text, p_artist text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not sc_apple_secret_ok(p_secret) then raise exception 'not authorized'; end if;
  update artists set apple_artist_id = 'none', apple_checked_at = now(), apple_claim_at = null where id = p_artist;
end;
$$;

-- One release's songs: add the Apple Music link to matching songs here.
-- p_tracks: [{title, url}]
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
  update tracks t set apple_url = m.url
  from (
    -- One song per title: the main song rather than a copy or version.
    select distinct on (k.k) k.track_id, x ->> 'url' as url
    from jsonb_array_elements(coalesce(p_tracks, '[]'::jsonb)) x
    join sc_known_keys(p_artist) k on k.k = sc_title_key(x ->> 'title')
    join tracks tt on tt.id = k.track_id
    where coalesce(x ->> 'url', '') ~ '^https://music\.apple\.com/'
    order by k.k, tt.parent_track_id is not null, tt.spotify_url is null, tt.id
  ) m
  where t.id = m.track_id and t.apple_url is null;
  get diagnostics v_n = row_count;
  update apple_albums set fetched_at = now(), claimed_at = null where artist_id = p_artist and album_id = p_album;
  perform set_config('static_cuts.batch_id', '', true);
  return v_n;
end;
$$;

revoke execute on function sc_apple_secret_ok(text), sc_apple_next(text), sc_apple_artist_try(text, text, text, jsonb),
  sc_apple_artist_none(text, text), sc_apple_album_save(text, text, text, jsonb) from public, anon, authenticated;

-- Song page: include the Apple Music link.
do $$
declare
  d text := pg_get_functiondef((select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                where n.nspname = 'public' and p.proname = 'rpc_song_page' limit 1));
begin
  if position('''apple_url''' in d) = 0 then
    if position('''deezer_url'', t.deezer_url,' in d) = 0 then raise exception 'could not update rpc_song_page'; end if;
    execute replace(d, '''deezer_url'', t.deezer_url,', '''deezer_url'', t.deezer_url, ''apple_url'', t.apple_url,');
  end if;
end $$;

select cron.unschedule(jobid) from cron.job where jobname = 'apple-music';
select cron.schedule('apple-music', '* * * * *', $c$
  select net.http_post(
    url := 'https://pcuyzaamcsegblrauxsa.supabase.co/functions/v1/apple-music',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select value from public.sc_private_settings where key = 'cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000);
$c$);
