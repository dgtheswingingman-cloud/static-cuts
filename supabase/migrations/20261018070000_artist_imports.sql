-- Auto-fill artist pages from Spotify, Genius and Last.fm.
--
-- The import-artist edge function does the fetching (slowly, see the rate
-- limit rule) and hands the songs to these functions:
--   Spotify  official songs: added straight to the page (or a missing link,
--            album and date filled in on a song already there). One undoable
--            batch per import.
--   Genius   suggestions: go to the import review list (/review/imports),
--   Last.fm  because they include unreleased songs and messy titles.
-- Songs already on the page (by title or alias, ignoring case, punctuation
-- and feat. tags) are skipped, and so are suggestions already made or
-- dismissed. New songs are linked under their main song automatically by
-- the sub-versions trigger.
--
-- Limits: signed-in users only; one import per artist per source per day;
-- 10 imports a day per person (admin unlimited); one at a time per artist.
-- Each imported song remembers its source, shown in the song's info.

alter table tracks add column if not exists source text;
alter table tracks add column if not exists source_url text;

create table if not exists import_runs (
  id uuid primary key default gen_random_uuid(),
  artist_id text not null references artists(id) on delete cascade,
  source text not null check (source in ('spotify', 'genius', 'lastfm')),
  requested_by uuid,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  added int not null default 0,
  updated int not null default 0,
  suggested int not null default 0,
  skipped int not null default 0,
  error text
);
create index if not exists import_runs_artist_idx on import_runs (artist_id, source, started_at desc);
create index if not exists import_runs_user_idx on import_runs (requested_by, started_at desc);

create table if not exists import_suggestions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references import_runs(id) on delete set null,
  artist_id text not null references artists(id) on delete cascade,
  source text not null,
  title text not null,
  title_key text not null,
  status_guess text not null default 'unconfirmed',
  url text,
  album text,
  release_date date,
  main_artist_name text,
  extra jsonb not null default '{}'::jsonb,
  state text not null default 'open' check (state in ('open', 'applied', 'dismissed')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  unique (artist_id, title_key)
);
create index if not exists import_suggestions_state_idx on import_suggestions (state, artist_id);

alter table import_runs enable row level security;
alter table import_suggestions enable row level security;
drop policy if exists import_runs_admin_read on import_runs;
create policy import_runs_admin_read on import_runs for select using (is_admin() or requested_by = auth.uid());
drop policy if exists import_suggestions_admin_read on import_suggestions;
create policy import_suggestions_admin_read on import_suggestions for select using (is_admin());
revoke all on import_runs, import_suggestions from anon;
revoke insert, update, delete on import_runs, import_suggestions from authenticated;

-- Start an import: checks the limits and records the run.
create or replace function sc_import_start(p_artist_id text, p_source text, p_user uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
  v_is_admin boolean;
  v_last import_runs%rowtype;
begin
  if p_user is null then raise exception 'Sign in to import songs.'; end if;
  if not exists (select 1 from artists where id = p_artist_id) then raise exception 'Unknown artist.'; end if;
  if p_source not in ('spotify', 'genius', 'lastfm') then raise exception 'Unknown source.'; end if;
  perform pg_advisory_xact_lock(hashtext('sc_import:' || p_artist_id));

  select exists (select 1 from auth.users where id = p_user and email = 'dg.theswingingman@gmail.com') into v_is_admin;

  if exists (select 1 from import_runs where artist_id = p_artist_id and finished_at is null
             and started_at > now() - interval '10 minutes') then
    raise exception 'An import for this artist is already running. Try again in a few minutes.';
  end if;

  select * into v_last from import_runs
  where artist_id = p_artist_id and source = p_source and error is null and finished_at is not null
  order by started_at desc limit 1;
  if not v_is_admin and v_last.started_at > now() - interval '1 day' then
    raise exception 'This artist was imported from % in the last day. Try again tomorrow.', p_source;
  end if;

  if not v_is_admin and (select count(*) from import_runs where requested_by = p_user
                         and started_at > now() - interval '1 day') >= 10 then
    raise exception 'You''ve reached today''s limit of 10 imports. Try again tomorrow.';
  end if;

  insert into import_runs (artist_id, source, requested_by) values (p_artist_id, p_source, p_user)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function sc_import_finish(p_run uuid, p_error text default null)
returns void
language sql
security definer
set search_path to 'public'
as $$
  update import_runs set finished_at = now(), error = left(p_error, 1000) where id = p_run;
$$;

-- Save a profile ID the import found, only if none is set yet (an admin
-- can correct it with the "profiles" button).
create or replace function sc_import_set_profile(p_artist_id text, p_field text, p_value text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_value is null or p_value = '' then return; end if;
  if p_field = 'spotify' then
    update artists set spotify_artist_id = p_value
    where id = p_artist_id and spotify_artist_id is null
      and not exists (select 1 from artists o where o.spotify_artist_id = p_value);
  elsif p_field = 'genius' then
    update artists set genius_artist_id = p_value
    where id = p_artist_id and (genius_artist_id is null or genius_artist_id like 'name:%')
      and not exists (select 1 from artists o where o.genius_artist_id = p_value);
  elsif p_field = 'lastfm' then
    update artists set lastfm_name = p_value where id = p_artist_id and lastfm_name is null;
  end if;
end;
$$;

-- Keys of every title and alias already on an artist's page (including songs
-- they appear on), for fast "already have it" checks.
create or replace function sc_known_keys(p_artist_id text)
returns table (k text, track_id text, spotify_url text, album text, release_date date)
language sql
stable
security definer
set search_path to 'public'
as $$
  with mine as (
    select tr.* from tracks tr
    where tr.artist_id = p_artist_id
       or exists (select 1 from track_appearances a where a.track_id = tr.id and a.artist_id = p_artist_id)
  )
  select sc_title_key(m.title), m.id, m.spotify_url, m.album, m.release_date from mine m
  union all
  select sc_title_key(al), m.id, m.spotify_url, m.album, m.release_date
  from mine m, regexp_split_to_table(coalesce(m.aliases, ''), '\s*[,;/\n]\s*') al
  where al <> '';
$$;

-- Spotify: add official songs. Items: [{title, spotify_url, album,
-- release_date, track_number, main_artist_name, featured}]
create or replace function sc_import_add_tracks(p_run uuid, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r import_runs%rowtype;
  v_name text;
  it jsonb;
  v_key text;
  v_known record;
  v_main text;
  v_home text;
  v_id text;
  v_added int := 0;
  v_updated int := 0;
  v_skipped int := 0;
begin
  select * into r from import_runs where id = p_run;
  if r.id is null or r.finished_at is not null then raise exception 'import run not active'; end if;
  select name into v_name from artists where id = r.artist_id;

  perform sc_begin_batch('import', 'Spotify import: ' || v_name);
  perform set_config('static_cuts.skip_status_log', 'on', true);

  create temp table if not exists _sc_known (k text, track_id text, spotify_url text, album text, release_date date) on commit drop;
  truncate _sc_known;
  insert into _sc_known select * from sc_known_keys(r.artist_id);
  create index if not exists _sc_known_k on _sc_known (k);

  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_key := sc_title_key(it ->> 'title');
    continue when v_key is null or v_key = '';

    -- Same link already in the archive anywhere: nothing to do.
    if nullif(it ->> 'spotify_url', '') is not null
       and exists (select 1 from tracks where spotify_url = it ->> 'spotify_url') then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    select * into v_known from _sc_known where k = v_key order by (spotify_url is null) limit 1;
    if v_known.track_id is not null then
      -- Already on the page: fill in what's missing.
      update tracks t set
        spotify_url = coalesce(t.spotify_url, nullif(it ->> 'spotify_url', '')),
        release_status = case when t.spotify_url is null and t.release_status <> 'removed' then 'released' else t.release_status end,
        album = coalesce(t.album, nullif(it ->> 'album', '')),
        release_date = coalesce(t.release_date, nullif(it ->> 'release_date', '')::date)
      where t.id = v_known.track_id
        and (t.spotify_url is null or t.album is null or t.release_date is null);
      if found then v_updated := v_updated + 1; else v_skipped := v_skipped + 1; end if;
      continue;
    end if;

    -- A feature on someone else's song goes on their page when they're in
    -- the archive, with this artist linked.
    v_main := case when nullif(it ->> 'main_artist_name', '') is not null then sc_find_artist(it ->> 'main_artist_name') end;
    v_home := coalesce(v_main, r.artist_id);
    if v_main is not null and exists (select 1 from sc_known_keys(v_main) kk where kk.k = v_key) then
      select kk.track_id into v_id from sc_known_keys(v_main) kk where kk.k = v_key limit 1;
      insert into track_appearances (track_id, artist_id) values (v_id, r.artist_id) on conflict do nothing;
      v_updated := v_updated + 1;
      continue;
    end if;

    v_id := v_home || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
    insert into tracks (id, artist_id, title, spotify_url, release_status, album, release_date, track_number,
                        is_featured, featured_artists, source, source_url, notes)
    values (
      v_id, v_home, it ->> 'title', nullif(it ->> 'spotify_url', ''), 'released',
      nullif(it ->> 'album', ''), nullif(it ->> 'release_date', '')::date, nullif(it ->> 'track_number', '')::int,
      -- A feature filed on this artist's own page (main artist not in the archive).
      v_main is null and nullif(it ->> 'main_artist_name', '') is not null,
      nullif(it ->> 'featured', ''),
      'spotify', nullif(it ->> 'spotify_url', ''),
      case when v_main is null and nullif(it ->> 'main_artist_name', '') is not null
           then 'Feature on ' || (it ->> 'main_artist_name') || '''s song.' end);
    if v_main is not null then
      insert into track_appearances (track_id, artist_id) values (v_id, r.artist_id) on conflict do nothing;
    end if;
    insert into _sc_known (k, track_id, spotify_url) values (v_key, v_id, it ->> 'spotify_url');
    v_added := v_added + 1;
  end loop;

  update import_runs set added = added + v_added, updated = updated + v_updated, skipped = skipped + v_skipped
  where id = p_run;
  return jsonb_build_object('added', v_added, 'updated', v_updated, 'skipped', v_skipped);
end;
$$;

-- Genius / Last.fm: suggestions for the import review list. Items:
-- [{title, url, album, release_date, status_guess, main_artist_name, extra}]
create or replace function sc_import_suggest(p_run uuid, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r import_runs%rowtype;
  it jsonb;
  v_key text;
  v_suggested int := 0;
  v_skipped int := 0;
begin
  select * into r from import_runs where id = p_run;
  if r.id is null or r.finished_at is not null then raise exception 'import run not active'; end if;

  create temp table if not exists _sc_known2 (k text) on commit drop;
  truncate _sc_known2;
  insert into _sc_known2 select k from sc_known_keys(r.artist_id);
  -- Finds already waiting in the discoveries review count as known too.
  insert into _sc_known2
  select sc_title_key(d.title || coalesce(' (' || d.version_hint || ')', ''))
  from discoveries d where (d.artist_id = r.artist_id or d.main_artist_id = r.artist_id) and d.state = 'open';

  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_key := sc_title_key(it ->> 'title');
    if v_key is null or v_key = '' or exists (select 1 from _sc_known2 where k = v_key) then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    insert into import_suggestions (run_id, artist_id, source, title, title_key, status_guess, url, album,
                                    release_date, main_artist_name, extra)
    values (
      p_run, r.artist_id, r.source, it ->> 'title', v_key,
      case when it ->> 'status_guess' in ('unconfirmed', 'rumored', 'teased', 'snippet', 'leaked', 'announced', 'released')
           then it ->> 'status_guess' else 'unconfirmed' end,
      nullif(it ->> 'url', ''), nullif(it ->> 'album', ''), nullif(it ->> 'release_date', '')::date,
      nullif(it ->> 'main_artist_name', ''), coalesce(it -> 'extra', '{}'::jsonb))
    on conflict (artist_id, title_key) do nothing;
    if found then v_suggested := v_suggested + 1; else v_skipped := v_skipped + 1; end if;
    insert into _sc_known2 values (v_key);
  end loop;

  update import_runs set suggested = suggested + v_suggested, skipped = skipped + v_skipped where id = p_run;
  return jsonb_build_object('suggested', v_suggested, 'skipped', v_skipped);
end;
$$;

-- ---------------------------------------------------------------------------
-- Import review list (/review/imports)
-- ---------------------------------------------------------------------------

create or replace function admin_import_suggestions(p_limit int default 2000)
returns table (
  id uuid, artist_id text, artist_name text, source text, title text, status_guess text, url text,
  album text, release_date date, main_artist_name text, extra jsonb, created_at timestamptz
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select s.id, s.artist_id, a.name, s.source, s.title, s.status_guess, s.url, s.album, s.release_date,
         s.main_artist_name, s.extra, s.created_at
  from import_suggestions s join artists a on a.id = s.artist_id
  where is_admin() and s.state = 'open'
  order by a.name, s.source, s.title
  limit greatest(1, least(coalesce(p_limit, 2000), 5000));
$$;

-- Approve: add the songs (status from the suggestion, or one you pick).
create or replace function admin_apply_import_suggestions(p_ids uuid[], p_status text default null)
returns int
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  s import_suggestions%rowtype;
  v_id text;
  v_main text;
  v_home text;
  n int := 0;
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  if p_status is not null and p_status not in ('unconfirmed', 'rumored', 'teased', 'snippet', 'leaked', 'announced', 'released') then
    raise exception 'unknown status';
  end if;
  perform sc_begin_batch('import', 'Import review: ' || coalesce(array_length(p_ids, 1), 0) || ' approved');
  perform set_config('static_cuts.skip_status_log', 'on', true);
  for s in select * from import_suggestions where id = any (p_ids[1:300]) and state = 'open' order by title loop
    -- Skip it if the song has turned up on the page meanwhile.
    if exists (select 1 from sc_known_keys(s.artist_id) k where k.k = s.title_key) then
      update import_suggestions set state = 'dismissed', decided_at = now() where id = s.id;
      continue;
    end if;
    v_main := case when s.main_artist_name is not null then sc_find_artist(s.main_artist_name) end;
    v_home := coalesce(v_main, s.artist_id);
    v_id := v_home || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
    insert into tracks (id, artist_id, title, release_status, album, release_date, is_featured, source, source_url, notes)
    values (v_id, v_home, s.title, coalesce(p_status, s.status_guess), s.album, s.release_date,
            v_main is null and s.main_artist_name is not null,
            s.source, s.url,
            case when v_main is null and s.main_artist_name is not null
                 then 'Feature on ' || s.main_artist_name || '''s song.' end);
    if v_main is not null then
      insert into track_appearances (track_id, artist_id) values (v_id, s.artist_id) on conflict do nothing;
    end if;
    update import_suggestions set state = 'applied', decided_at = now() where id = s.id;
    n := n + 1;
  end loop;
  return n;
end;
$$;

create or replace function admin_dismiss_import_suggestions(p_ids uuid[])
returns int
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  n int;
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  update import_suggestions set state = 'dismissed', decided_at = now() where id = any (p_ids) and state = 'open';
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Last imports for an artist, for the artist page panel.
create or replace function rpc_artist_imports(p_artist_id text)
returns table (source text, started_at timestamptz, finished_at timestamptz, added int, updated int,
               suggested int, skipped int, error text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select distinct on (source) source, started_at, finished_at, added, updated, suggested, skipped, error
  from import_runs where artist_id = p_artist_id
  order by source, started_at desc;
$$;

-- Queue wording fix: "only 1 song", not "only 1 songs".
do $$
declare
  d text;
begin
  select pg_get_functiondef('public.sc_artist_queue(int, boolean)'::regprocedure) into d;
  d := replace(d, $q$'only ' || s.n_tracks || ' songs'$q$,
               $q$'only ' || s.n_tracks || case when s.n_tracks = 1 then ' song' else ' songs' end$q$);
  execute d;
end $$;

revoke execute on function sc_import_start(text, text, uuid), sc_import_finish(uuid, text),
  sc_import_set_profile(text, text, text), sc_known_keys(text), sc_import_add_tracks(uuid, jsonb),
  sc_import_suggest(uuid, jsonb) from public, anon, authenticated;
grant execute on function sc_import_start(text, text, uuid), sc_import_finish(uuid, text),
  sc_import_set_profile(text, text, text), sc_import_add_tracks(uuid, jsonb), sc_import_suggest(uuid, jsonb)
  to service_role;
revoke execute on function admin_import_suggestions(int), admin_apply_import_suggestions(uuid[], text),
  admin_dismiss_import_suggestions(uuid[]), rpc_artist_imports(text) from public, anon;
grant execute on function admin_import_suggestions(int), admin_apply_import_suggestions(uuid[], text),
  admin_dismiss_import_suggestions(uuid[]), rpc_artist_imports(text) to authenticated;
