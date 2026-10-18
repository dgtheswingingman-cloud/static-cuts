-- Community spreadsheet imports.
--
-- Communities keep trackers in Google Sheets (City Morgue, Carti, Ye...).
-- You or a moderator paste a sheet tab's link on /admin/sheets, check how
-- its columns are read, and import it. The sheet-import function reads the
-- sheet; the songs land in the imported songs review list with the usual
-- duplicate and sub-version checks.
--
--   sheet_sources   each imported sheet tab: its makers (credit), the
--                   artist it's for, how its columns are read, and whether
--                   to check it for new songs every night
--   sheet_requests  links people have sent in ("please import this")
--
-- Credit: songs from a sheet show "from <sheet>, by <makers>" with a link to
-- the sheet, and every sheet is listed on /sources. Importers confirm they
-- made the sheet or have the makers' OK.
--
-- Updates: sheets with "check nightly" on are re-read every night at 04:23;
-- only songs that aren't on the site or already in the review list are
-- suggested (songs you turned down stay turned down).

alter table import_runs drop constraint if exists import_runs_source_check;
alter table import_runs add constraint import_runs_source_check check (source in ('spotify', 'genius', 'lastfm', 'sheet'));

create table if not exists sheet_sources (
  id uuid primary key default gen_random_uuid(),
  sheet_id text not null,
  gid text not null default '0',
  url text not null,
  title text not null,
  tab_name text,
  credit text,
  artist_id text not null references artists (id) on delete cascade,
  mapping jsonb not null default '{}'::jsonb,
  auto_sync boolean not null default true,
  permission_confirmed boolean not null default false,
  added_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  last_synced_at timestamptz,
  last_result jsonb,
  unique (sheet_id, gid)
);
alter table sheet_sources enable row level security;
drop policy if exists sheet_sources_read on sheet_sources;
create policy sheet_sources_read on sheet_sources for select using (true);
revoke insert, update, delete on sheet_sources from anon, authenticated;

create table if not exists sheet_requests (
  id uuid primary key default gen_random_uuid(),
  sheet_id text not null,
  gid text,
  url text not null,
  note text,
  artist_name text,
  requested_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  state text not null default 'open' check (state in ('open', 'imported', 'declined')),
  source_id uuid references sheet_sources (id) on delete set null,
  handled_at timestamptz
);
create index if not exists sheet_requests_sheet_idx on sheet_requests (sheet_id, state);
alter table sheet_requests enable row level security;
drop policy if exists sheet_requests_read on sheet_requests;
create policy sheet_requests_read on sheet_requests for select
  using ((select is_moderator()) or requested_by = (select auth.uid()));
revoke insert, update, delete on sheet_requests from anon, authenticated;

-- The id and tab of a Google Sheets link.
create or replace function sc_parse_sheet_url(p_url text, out sheet_id text, out gid text)
returns record
language sql
immutable
as $$
  select substring(p_url from '/spreadsheets/d/([A-Za-z0-9_-]{20,})'),
         coalesce(substring(p_url from '[#?&]gid=([0-9]+)'), '0');
$$;

-- Whether a user (checked by the sheet-import function) can moderate.
create or replace function sc_user_can_moderate(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (select 1 from auth.users where id = p_user and email = 'dg.theswingingman@gmail.com')
      or exists (select 1 from moderators where user_id = p_user);
$$;

-- Save (or update) a sheet source. Called by the sheet-import function.
create or replace function sc_sheet_save_source(p_user uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
  v_sheet text;
  v_gid text;
begin
  if not sc_user_can_moderate(p_user) then raise exception 'Only moderators can import sheets.'; end if;
  select * into v_sheet, v_gid from sc_parse_sheet_url(p ->> 'url');
  if v_sheet is null then raise exception 'That isn''t a Google Sheets link.'; end if;
  if not coalesce((p ->> 'permission_confirmed')::boolean, false) then
    raise exception 'Confirm you made this sheet or have its makers'' OK first.';
  end if;
  if not exists (select 1 from artists where id = p ->> 'artist_id') then raise exception 'Pick the artist this sheet is for.'; end if;
  insert into sheet_sources (sheet_id, gid, url, title, tab_name, credit, artist_id, mapping, auto_sync,
                             permission_confirmed, added_by)
  values (v_sheet, v_gid, p ->> 'url', coalesce(nullif(trim(p ->> 'title'), ''), 'Community sheet'),
          nullif(trim(p ->> 'tab_name'), ''), nullif(trim(p ->> 'credit'), ''), p ->> 'artist_id',
          coalesce(p -> 'mapping', '{}'::jsonb), coalesce((p ->> 'auto_sync')::boolean, true), true, p_user)
  on conflict (sheet_id, gid) do update set
    url = excluded.url, title = excluded.title, tab_name = excluded.tab_name, credit = excluded.credit,
    artist_id = excluded.artist_id, mapping = excluded.mapping, auto_sync = excluded.auto_sync,
    permission_confirmed = true
  returning id into v_id;
  return v_id;
end;
$$;

-- Suggest a sheet's songs. Each item: {title, artists: [names before the
-- dash], status, album, release_date, featuring, producers, notes,
-- listen_url}. A song credited to someone else on the site goes on their
-- page (a member's solo song in a group's tracker); otherwise on the
-- sheet's artist.
create or replace function sc_sheet_import(p_user uuid, p_source uuid, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  src sheet_sources%rowtype;
  it jsonb;
  v_home text;
  v_named text;
  v_runs jsonb := '{}'::jsonb;
  v_run uuid;
  v_res jsonb;
  v_suggested int := 0;
  v_skipped int := 0;
  v_other text;
  v_note text;
  v_names text[];
  g record;
begin
  select * into src from sheet_sources where id = p_source;
  if src.id is null then raise exception 'unknown sheet'; end if;
  if not sc_user_can_moderate(p_user) then raise exception 'Only moderators can import sheets.'; end if;

  create temp table if not exists _sc_sheet_items (home text, item jsonb) on commit drop;
  truncate _sc_sheet_items;

  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    continue when coalesce(trim(it ->> 'title'), '') = '';
    select coalesce(array_agg(x order by n), '{}') into v_names
    from jsonb_array_elements_text(coalesce(it -> 'artists', '[]'::jsonb)) with ordinality a(x, n)
    where trim(x) <> '';
    -- Home: the first name before the dash that's an artist here, else the
    -- sheet's artist.
    v_home := null;
    foreach v_named in array v_names loop
      v_home := sc_find_artist(v_named);
      exit when v_home is not null;
    end loop;
    v_note := it ->> 'notes';
    v_other := null;
    if v_home is null and cardinality(v_names) > 0
       and lower(v_names[1]) <> lower((select name from artists where id = src.artist_id)) then
      -- Credited to someone without a page here (e.g. a side project).
      v_note := concat_ws(E'\n', 'Credited to ' || array_to_string(v_names, ' & ') || '.', v_note);
    else
      -- Everyone else named before the dash counts as featured.
      select string_agg(x, ', ') into v_other from unnest(v_names) x
      where sc_find_artist(x) is distinct from coalesce(v_home, src.artist_id)
        and lower(x) <> lower((select name from artists where id = coalesce(v_home, src.artist_id)));
    end if;
    v_home := coalesce(v_home, src.artist_id);
    insert into _sc_sheet_items values (v_home, jsonb_build_object(
      'title', trim(it ->> 'title'),
      'status_guess', it ->> 'status',
      'url', src.url,
      'album', nullif(trim(it ->> 'album'), ''),
      'release_date', nullif(it ->> 'release_date', ''),
      'extra', jsonb_strip_nulls(jsonb_build_object(
        'featuring', nullif(concat_ws(', ', nullif(v_other, ''), nullif(it ->> 'featuring', '')), ''),
        'producers', nullif(it ->> 'producers', ''),
        'notes', nullif(v_note, ''),
        'listen_url', nullif(it ->> 'listen_url', ''),
        'sheet_source', src.id))));
  end loop;

  for g in select home, jsonb_agg(item) items from _sc_sheet_items group by home loop
    insert into import_runs (artist_id, source, requested_by) values (g.home, 'sheet', p_user) returning id into v_run;
    v_res := sc_import_suggest(v_run, g.items);
    update import_runs set finished_at = now() where id = v_run;
    v_suggested := v_suggested + (v_res ->> 'suggested')::int;
    v_skipped := v_skipped + (v_res ->> 'skipped')::int;
    v_runs := v_runs || jsonb_build_object(g.home, v_res);
  end loop;

  v_res := jsonb_build_object('suggested', v_suggested, 'skipped', v_skipped, 'artists', v_runs, 'at', now());
  update sheet_sources set last_synced_at = now(), last_result = v_res where id = src.id;
  update sheet_requests set state = 'imported', source_id = src.id, handled_at = now()
  where sheet_id = src.sheet_id and (gid is null or gid = src.gid) and state = 'open';
  return v_res;
end;
$$;

-- Nightly check: which sheets are due (called by the sheet-import function
-- with the timer's password).
create or replace function sc_sheet_sync_due(p_secret text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then
    raise exception 'not authorized';
  end if;
  return jsonb_build_object(
    'user_id', (select id from auth.users where email = 'dg.theswingingman@gmail.com'),
    'sources', (select coalesce(jsonb_agg(id), '[]'::jsonb) from (
      select id from sheet_sources
      where auto_sync and (last_synced_at is null or last_synced_at < now() - interval '20 hours')
      order by last_synced_at nulls first limit 10) s));
end;
$$;

-- Approving a sheet song keeps its producers, notes and listen link.
do $$
declare
  d text;
begin
  select pg_get_functiondef('public.admin_apply_import_suggestions(uuid[], text)'::regprocedure) into d;
  if d not like '%extra ->> ''producers''%' then
    d := replace(d, $x$source, source_url, notes)$x$, $x$source, source_url, notes, producers, spotify_url)$x$);
    d := replace(d, $x$'''s song.' end);$x$,
      $x$'''s song.' else nullif(s.extra ->> 'notes', '') end,
            nullif(s.extra ->> 'producers', ''), nullif(s.extra ->> 'listen_url', ''));$x$);
    if d not like '%extra ->> ''producers''%' or d not like '%notes, producers, spotify_url)%' then
      raise exception 'could not update admin_apply_import_suggestions';
    end if;
    execute d;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Requests from the community
-- ---------------------------------------------------------------------------

create or replace function rpc_request_sheet(p_url text, p_artist_name text default null, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_sheet text;
  v_gid text;
  src sheet_sources%rowtype;
begin
  if auth.uid() is null or is_oauth_client() then raise exception 'Sign in to send a sheet.'; end if;
  select * into v_sheet, v_gid from sc_parse_sheet_url(p_url);
  if v_sheet is null then raise exception 'That isn''t a Google Sheets link.'; end if;
  select * into src from sheet_sources where sheet_id = v_sheet and gid = v_gid;
  if src.id is null then select * into src from sheet_sources where sheet_id = v_sheet order by created_at limit 1; end if;
  if src.id is not null then
    return jsonb_build_object('result', 'already_imported', 'title', src.title, 'same_tab', src.gid = v_gid);
  end if;
  if exists (select 1 from sheet_requests where sheet_id = v_sheet and state = 'open') then
    if not exists (select 1 from sheet_requests where sheet_id = v_sheet and requested_by = auth.uid()) then
      insert into sheet_requests (sheet_id, gid, url, note, artist_name, requested_by)
      values (v_sheet, v_gid, p_url, nullif(trim(p_note), ''), nullif(trim(p_artist_name), ''), auth.uid());
    end if;
    return jsonb_build_object('result', 'already_requested');
  end if;
  if (select count(*) from sheet_requests where requested_by = auth.uid() and created_at > now() - interval '1 day') >= 5 then
    raise exception 'That''s 5 sheets today. Try again tomorrow.';
  end if;
  insert into sheet_requests (sheet_id, gid, url, note, artist_name, requested_by)
  values (v_sheet, v_gid, p_url, nullif(trim(p_note), ''), nullif(trim(p_artist_name), ''), auth.uid());
  return jsonb_build_object('result', 'requested');
end;
$$;

create or replace function admin_sheet_requests()
returns table (sheet_id text, url text, artist_name text, notes text, people bigint, first_at timestamptz, ids uuid[])
language sql
stable
security definer
set search_path to 'public'
as $$
  select r.sheet_id, (array_agg(r.url order by r.created_at))[1], max(r.artist_name),
         string_agg(r.note, ' · '), count(*), min(r.created_at), array_agg(r.id)
  from sheet_requests r
  where is_moderator() and r.state = 'open'
  group by r.sheet_id
  order by count(*) desc, min(r.created_at);
$$;

create or replace function admin_decline_sheet_request(p_sheet_id text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not is_moderator() then raise exception 'not authorized'; end if;
  update sheet_requests set state = 'declined', handled_at = now() where sheet_id = p_sheet_id and state = 'open';
end;
$$;

-- Moderators: change a source's nightly check or remove it (its songs stay).
create or replace function admin_update_sheet_source(p_id uuid, p_auto_sync boolean, p_delete boolean default false)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not is_moderator() then raise exception 'not authorized'; end if;
  if p_delete then
    delete from sheet_sources where id = p_id;
  else
    update sheet_sources set auto_sync = p_auto_sync where id = p_id;
  end if;
end;
$$;

-- Public list of every sheet used, for /sources.
create or replace function rpc_sheet_sources()
returns table (id uuid, title text, tab_name text, credit text, url text, artist_id text, artist text,
               songs bigint, created_at timestamptz, last_synced_at timestamptz, auto_sync boolean)
language sql
stable
security definer
set search_path to 'public'
as $$
  select s.id, s.title, s.tab_name, s.credit, s.url, s.artist_id, a.name,
         (select count(*) from tracks t where t.source = 'sheet' and t.source_url = s.url),
         s.created_at, s.last_synced_at, s.auto_sync
  from sheet_sources s join artists a on a.id = s.artist_id
  order by a.name, s.title;
$$;

-- Song pages: name the sheet and its makers.
create or replace function rpc_sheet_credit(p_url text)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select jsonb_build_object('title', title, 'credit', credit, 'url', url)
  from sheet_sources where url = p_url limit 1;
$$;

revoke execute on function sc_user_can_moderate(uuid), sc_sheet_save_source(uuid, jsonb), sc_sheet_import(uuid, uuid, jsonb),
  sc_sheet_sync_due(text) from public, anon, authenticated;
grant execute on function sc_user_can_moderate(uuid), sc_sheet_save_source(uuid, jsonb), sc_sheet_import(uuid, uuid, jsonb),
  sc_sheet_sync_due(text) to service_role;
revoke execute on function rpc_request_sheet(text, text, text), admin_sheet_requests(), admin_decline_sheet_request(text),
  admin_update_sheet_source(uuid, boolean, boolean) from public, anon;
grant execute on function rpc_request_sheet(text, text, text), admin_sheet_requests(), admin_decline_sheet_request(text),
  admin_update_sheet_source(uuid, boolean, boolean) to authenticated;
grant execute on function rpc_sheet_sources(), rpc_sheet_credit(text), sc_parse_sheet_url(text) to anon, authenticated;

-- The nightly check, 04:23 UTC.
select cron.unschedule('sheet-sync') where exists (select 1 from cron.job where jobname = 'sheet-sync');
select cron.schedule('sheet-sync', '23 4 * * *', $job$
  select net.http_post(
    url := 'https://pcuyzaamcsegblrauxsa.supabase.co/functions/v1/sheet-import',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select value from public.sc_private_settings where key = 'cron_secret')),
    body := '{"action":"sync"}'::jsonb,
    timeout_milliseconds := 300000);
$job$);
