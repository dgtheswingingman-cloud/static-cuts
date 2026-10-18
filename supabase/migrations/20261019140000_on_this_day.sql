-- "On this day": songs released or leaked on today's date in past years.
--
-- Leak dates get their own column (tracks.leak_date), filled from sheet
-- imports (their leak date column) and from notes that say "Leaked
-- <date>.". Release dates already live in tracks.release_date.

alter table tracks add column if not exists leak_date date;
create index if not exists tracks_release_md_idx on tracks ((to_char(release_date, 'MM-DD'))) where release_date is not null;
create index if not exists tracks_leak_md_idx on tracks ((to_char(leak_date, 'MM-DD'))) where leak_date is not null;

-- "Leaked Dec 20, 2023." in notes -> 2023-12-20 (null if it isn't a date).
create or replace function sc_leak_date_from_notes(p_notes text)
returns date
language plpgsql
immutable
as $$
declare
  m text;
begin
  m := substring(p_notes from 'Leaked ([A-Z][a-z]{2,8} \d{1,2}, \d{4})');
  if m is null then return null; end if;
  begin
    return to_date(m, 'Mon DD, YYYY');
  exception when others then
    return to_date(m, 'FMMonth DD, YYYY');
  end;
exception when others then
  return null;
end;
$$;

update tracks set leak_date = sc_leak_date_from_notes(notes)
where leak_date is null and notes like '%Leaked %';

-- Sheet imports pass the leak date along...
do $$
declare
  d text;
begin
  select pg_get_functiondef('public.sc_sheet_import(uuid, uuid, jsonb)'::regprocedure) into d;
  if d not like '%''leak_date''%' then
    d := replace(d, $x$'listen_url', nullif(it ->> 'listen_url', ''),$x$,
                    $x$'listen_url', nullif(it ->> 'listen_url', ''), 'leak_date', nullif(it ->> 'leak_date', ''),$x$);
    if d not like '%''leak_date''%' then raise exception 'could not update sc_sheet_import'; end if;
    execute d;
  end if;
end $$;

-- ...and adding an imported song keeps it.
create or replace function admin_apply_import_suggestions(p_ids uuid[], p_status text default null)
returns int
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  s import_suggestions%rowtype;
  v_id text;
  v_main text;
  v_home text;
  n int := 0;
begin
  if not is_moderator() then raise exception 'not authorized'; end if;
  if p_status is not null and p_status not in ('unconfirmed', 'rumored', 'teased', 'snippet', 'leaked', 'announced', 'released') then
    raise exception 'unknown status';
  end if;
  perform sc_begin_batch('import', 'Import review: ' || coalesce(array_length(p_ids, 1), 0) || ' approved');
  perform set_config('static_cuts.skip_status_log', 'on', true);

  -- Every song already on these artists' pages, read once.
  create temp table if not exists _sc_apply_known (artist_id text, k text) on commit drop;
  truncate _sc_apply_known;
  insert into _sc_apply_known
  select a.artist_id, k.k
  from (select distinct artist_id from import_suggestions where id = any (p_ids[1:300]) and state = 'open') a,
       lateral sc_known_keys(a.artist_id) k;

  for s in select * from import_suggestions where id = any (p_ids[1:300]) and state = 'open' order by title loop
    if exists (select 1 from _sc_apply_known where artist_id = s.artist_id
               and k in (sc_title_key(s.title), sc_song_key(s.title))) then
      update import_suggestions set state = 'dismissed', decided_at = now() where id = s.id;
      continue;
    end if;
    v_main := case when s.main_artist_name is not null then sc_find_artist(s.main_artist_name) end;
    v_home := coalesce(v_main, s.artist_id);
    perform set_config('static_cuts.credit_user', coalesce((select requested_by::text from import_runs where id = s.run_id), ''), true);
    v_id := v_home || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
    insert into tracks (id, artist_id, title, release_status, album, release_date, is_featured, featured_artists,
                        source, source_url, notes, producers, spotify_url, leak_date)
    values (v_id, v_home, s.title, coalesce(p_status, s.status_guess), s.album, s.release_date,
            v_main is null and s.main_artist_name is not null,
            nullif(s.extra ->> 'featuring', ''),
            s.source, s.url,
            case when v_main is null and s.main_artist_name is not null
                 then 'Feature on ' || s.main_artist_name || '''s song.' else nullif(s.extra ->> 'notes', '') end,
            nullif(s.extra ->> 'producers', ''), nullif(s.extra ->> 'listen_url', ''),
            coalesce(nullif(s.extra ->> 'leak_date', '')::date, sc_leak_date_from_notes(s.extra ->> 'notes')));
    if v_main is not null then
      insert into track_appearances (track_id, artist_id) values (v_id, s.artist_id) on conflict do nothing;
    end if;
    insert into _sc_apply_known values (s.artist_id, sc_title_key(s.title)), (s.artist_id, sc_song_key(s.title));
    update import_suggestions set state = 'applied', decided_at = now() where id = s.id;
    n := n + 1;
  end loop;
  return n;
end;
$fn$;

-- Anniversaries for a day (default today, UK time). Busiest artists first.
create or replace function rpc_on_this_day(p_day date default null, p_limit int default 40)
returns table (kind text, on_date date, years_ago int, track_id text, title text, artist_id text, artist text,
               status text, spotify_url text, album text)
language sql
stable
security definer
set search_path to 'public'
as $$
  with d as (select coalesce(p_day, (now() at time zone 'Europe/London')::date) as day),
  hits as (
    select 'released'::text kind, t.release_date on_date, t.* from tracks t, d
    where t.release_date is not null and to_char(t.release_date, 'MM-DD') = to_char(d.day, 'MM-DD') and t.release_date < d.day
    union all
    select 'leaked', t.leak_date, t.* from tracks t, d
    where t.leak_date is not null and to_char(t.leak_date, 'MM-DD') = to_char(d.day, 'MM-DD') and t.leak_date < d.day
  )
  select h.kind, h.on_date, (extract(year from d.day) - extract(year from h.on_date))::int, h.id, h.title, h.artist_id, a.name,
         coalesce(h.release_status, case when h.is_official then 'released' else 'unconfirmed' end), h.spotify_url, h.album
  from hits h join artists a on a.id = h.artist_id, d
  where h.parent_track_id is null
  order by (select count(*) from follows f where f.artist_id = h.artist_id) desc, h.on_date, h.title
  limit greatest(1, least(coalesce(p_limit, 40), 200));
$$;

-- Song pages show the leak date.
do $$
declare
  d text;
begin
  select pg_get_functiondef('public.rpc_song_page(text)'::regprocedure) into d;
  if d not like '%''leak_date''%' then
    d := replace(d, $x$'release_date', t.release_date,$x$, $x$'release_date', t.release_date, 'leak_date', t.leak_date,$x$);
    if d not like '%''leak_date''%' then raise exception 'could not update rpc_song_page'; end if;
    execute d;
  end if;
end $$;

revoke execute on function rpc_on_this_day(date, int) from public;
grant execute on function rpc_on_this_day(date, int) to anon, authenticated;
