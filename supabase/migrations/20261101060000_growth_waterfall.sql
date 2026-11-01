-- How the archive grows, in order (and never sitting idle while there's
-- room in a queue):
--
--   1. Existing songs: fill in what each artist's songs are missing
--      (Spotify, Genius credits, Deezer). Those jobs already run all the time.
--   2. New songs: the Genius and Last.fm imports. An artist whose existing
--      songs are filled in goes before one still being filled in. When no
--      artist is due, the import takes whoever was checked longest ago
--      instead of sitting idle. Last.fm now runs every 10 minutes like
--      Genius (it was hourly, so a full pass took over a month).
--   3. New artists: once every artist here has had a Genius and a Last.fm
--      check in the last 14 days, up to 10 new artist pages a day:
--        a. guests (people credited on songs here) confirmed on Spotify,
--           biggest first;
--        b. then artists that 3+ artists here list as similar on Last.fm.
--      Each new artist then goes through 1 and 2 itself.
--
-- Also: automatic jobs' undo history is kept 14 days (people's changes
-- still 60).

-- ---------------------------------------------------------------------------
-- Settings and the record of artists added automatically
-- ---------------------------------------------------------------------------
insert into sc_private_settings (key, value) values ('new_artists_per_day', '10') on conflict (key) do nothing;

create table if not exists artist_additions (
  id bigint generated always as identity primary key,
  artist_id text,
  name text not null,
  source text not null check (source in ('guest', 'related')),
  note text,
  created_at timestamptz not null default now()
);
create index if not exists artist_additions_created_idx on artist_additions (created_at desc);
alter table artist_additions enable row level security;
drop policy if exists artist_additions_mod_read on artist_additions;
create policy artist_additions_mod_read on artist_additions for select using (is_moderator());
revoke insert, update, delete on artist_additions from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Step 1 check: does this artist still have existing songs to fill in?
-- ---------------------------------------------------------------------------
create or replace function sc_artist_existing_work(p_artist text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (select 1 from tracks t
                 where t.artist_id = p_artist and t.genius_checked_at is null and t.genius_song_id is null
                   and (t.producers is null or t.featured_artists is null or t.cover_url is null))
      or exists (select 1 from deezer_albums d where d.artist_id = p_artist and d.fetched_at is null)
      or (coalesce((select spotify_artist_id from artists where id = p_artist), '') !~ '^[A-Za-z0-9]{22}$'
          and exists (select 1 from tracks t
                      where t.artist_id = p_artist and t.spotify_url is null and t.spotify_search_attempted_at is null
                        and coalesce(t.release_status, '') not in ('leaked', 'snippet', 'announced', 'rumored', 'teased')));
$$;

-- ---------------------------------------------------------------------------
-- Step 2: the imports pick the next artist (never idle while there's room)
-- ---------------------------------------------------------------------------
create or replace function sc_scheduled_import_next(p_secret text, p_source text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_admin uuid;
  v_used int;
  v_pick text;
  v_claim text := 'timer:' || p_source;
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then
    raise exception 'not authorized';
  end if;
  if p_source not in ('genius', 'lastfm', 'spotify') then raise exception 'unknown source'; end if;
  select id into v_admin from auth.users where email = 'dg.theswingingman@gmail.com';

  -- One picker at a time per source, and the same 6-an-hour allowance.
  perform pg_advisory_xact_lock(hashtext('sc_claim_artists:' || v_claim));
  select count(*) into v_used from artist_queue_claims where source = v_claim and claimed_at > now() - interval '1 hour';
  if v_used >= 6 then return jsonb_build_object('reason', 'hourly limit reached'); end if;

  with q as (
    select q.artist_id, q.due, row_number() over () ord
    from sc_artist_queue(5000, false) q
    join artists a on a.id = q.artist_id and not a.catalogue_hold
  ),
  c as (
    select q.*, (select max(r.started_at) from import_runs r where r.artist_id = q.artist_id and r.source = p_source) last_run
    from q
    where not exists (select 1 from artist_queue_claims x where x.source = v_claim and x.artist_id = q.artist_id
                        and x.claimed_at > now() - interval '1 day')
  ),
  ok as (
    select c.*, (c.due and (c.last_run is null or c.last_run < now() - interval '7 days')) as due_now
    from c
    where (c.due and (c.last_run is null or c.last_run < now() - interval '7 days'))
       or c.last_run is null or c.last_run < now() - interval '3 days'
  )
  -- Due first; among those, artists whose existing songs are filled in
  -- first; then the usual queue order. Nobody due: longest since checked.
  select ok.artist_id into v_pick from ok
  order by ok.due_now desc,
           case when ok.due_now then sc_artist_existing_work(ok.artist_id) end,
           case when ok.due_now then ok.ord end,
           ok.last_run nulls first, ok.ord
  limit 1;

  if v_pick is null then
    return jsonb_build_object('reason', 'every artist was checked in the last 3 days');
  end if;
  insert into artist_queue_claims (source, artist_id) values (v_claim, v_pick);
  return jsonb_build_object('artist_id', v_pick, 'user_id', v_admin);
end;
$$;

-- Last.fm: every 10 minutes, like Genius.
select cron.alter_job(jobid, schedule := '1-59/10 * * * *') from cron.job where jobname = 'lastfm-import';

-- ---------------------------------------------------------------------------
-- Step 3: new artists, once every artist here has been checked
-- ---------------------------------------------------------------------------
create or replace function sc_catalogue_sweep_done()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select not exists (
    select 1 from artists a
    where not a.catalogue_hold
      and (not exists (select 1 from import_runs r where r.artist_id = a.id and r.source = 'genius' and r.started_at > now() - interval '14 days')
        or not exists (select 1 from import_runs r where r.artist_id = a.id and r.source = 'lastfm' and r.started_at > now() - interval '14 days')));
$$;

create or replace function sc_new_artists_left()
returns integer
language sql
stable
security definer
set search_path to 'public'
as $$
  select case when sc_hold_new_catalogues() or not sc_catalogue_sweep_done() then 0
    else greatest(0, coalesce((select nullif(value, '')::int from sc_private_settings where key = 'new_artists_per_day'), 10)
                     - (select count(*) from artist_additions where created_at > now() - interval '1 day'))::int
  end;
$$;

-- Artists that several artists here list as similar on Last.fm, not here
-- yet. Collab names ("A & B", "A x B") are left out, and "$" counts as "s"
-- so "Travi$ Scott" is recognised as Travis Scott. (The slower fuzzy
-- "already here?" check runs only on the one about to be added.)
create or replace function sc_related_candidates(p_limit integer default 20)
returns table(name text, mentions integer, weight integer, why text)
language sql
stable
security definer
set search_path to 'public'
as $$
  with w as materialized (select * from sc_artist_weights()),
  s as (
    select a.id, a.name artist_name, trim(x) nm, coalesce(w.weight, 0) wt
    from artists a cross join unnest(a.lastfm_similar) x left join w on w.artist_id = a.id
    where trim(x) <> '' and trim(x) !~* '( & | x | feat\.? | ft\.? |, | and | with )'
  ),
  g as materialized (
    select min(s.nm) nm, count(distinct s.id)::int mentions, sum(s.wt)::int wt, string_agg(distinct s.artist_name, ', ') why
    from s group by lower(s.nm) having count(distinct s.id) >= 3
  ),
  here as materialized (
    select sc_normalize_title(replace(name, '$', 's')) k from artists
    union select alias_key from artist_aliases
  )
  select g.nm, g.mentions, g.wt, g.why from g
  where sc_normalize_title(replace(g.nm, '$', 's')) <> ''
    and not exists (select 1 from here h where h.k = sc_normalize_title(replace(g.nm, '$', 's')))
    and not exists (select 1 from artist_additions x where lower(x.name) = lower(g.nm))
  order by g.mentions desc, g.wt desc, g.nm
  limit greatest(1, least(coalesce(p_limit, 20), 200));
$$;

-- Guests: creating a page now respects the daily limit and is recorded.
create or replace function sc_guest_result(p_secret text, p_key text, p_action text, p_artist text default null,
  p_spotify_id text default null, p_spotify_name text default null, p_note text default null)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  g guest_artists%rowtype;
  v_artist text;
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then
    raise exception 'not authorized';
  end if;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  select * into g from guest_artists where name_key = p_key;
  if g.name_key is null then return null; end if;
  if p_action = 'review' then
    update guest_artists set state = 'review', note = p_note, checked_at = now(),
           spotify_artist_id = coalesce(p_spotify_id, spotify_artist_id)
    where name_key = p_key;
    return null;
  end if;
  if p_action = 'link' then
    v_artist := p_artist;
  else
    v_artist := coalesce((select id from artists where spotify_artist_id = p_spotify_id limit 1), sc_find_artist(g.name));
    if v_artist is null then
      -- A new page: only within today's allowance, and only once every
      -- artist here has been checked. Otherwise keep them for later.
      if sc_new_artists_left() <= 0 then
        update guest_artists set checked_at = now(), spotify_artist_id = coalesce(p_spotify_id, spotify_artist_id),
               note = 'Waiting: existing artists are being filled in first.'
        where name_key = p_key and state = 'pending';
        return null;
      end if;
      v_artist := lower(regexp_replace(coalesce(p_spotify_name, g.name), '[^a-zA-Z0-9]+', '-', 'g'))
                  || '-' || substr(gen_random_uuid()::text, 1, 8);
      v_artist := trim(both '-' from v_artist);
      perform set_config('static_cuts.batch_id', '', true);
      perform sc_begin_batch('guests', 'New artist page: ' || coalesce(p_spotify_name, g.name));
      insert into artists (id, name, status, spotify_artist_id) values (v_artist, coalesce(p_spotify_name, g.name), 'ONGOING', p_spotify_id);
      insert into artist_additions (artist_id, name, source, note)
      values (v_artist, coalesce(p_spotify_name, g.name), 'guest', g.songs || ' song' || case when g.songs = 1 then '' else 's' end || ' credited here');
    end if;
  end if;
  perform set_config('static_cuts.batch_id', '', true);
  perform sc_begin_batch('guests', 'Songs moved to ' || coalesce(p_spotify_name, g.name) || '''s page');
  perform sc_guest_move(p_key, v_artist);
  update guest_artists set state = case when p_action = 'link' then 'linked' else 'created' end, artist_id = v_artist,
         spotify_artist_id = coalesce(p_spotify_id, spotify_artist_id), songs = 0, checked_at = now(), note = null
  where name_key = p_key;
  return v_artist;
end;
$$;

-- The guest job: may it make new pages now?
create or replace function sc_guest_next(p_secret text, p_limit integer default 8)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_wait boolean := sc_new_artists_left() <= 0;
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then
    raise exception 'not authorized';
  end if;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  return jsonb_build_object(
    'known', (select coalesce(jsonb_object_agg(spotify_artist_id, id), '{}'::jsonb) from artists where spotify_artist_id is not null),
    'new_pages', not v_wait,
    'guests', (
      with top as (
        select g.* from guest_artists g
        where g.state = 'pending' and g.songs > 0
          -- While new pages wait, each guest is looked at once a week (in
          -- case they turn out to be an artist already here).
          and (not v_wait or g.checked_at is null or g.checked_at < now() - interval '7 days')
        order by g.host_weight desc, g.songs desc, g.name
        limit greatest(1, least(coalesce(p_limit, 8), 20))
      )
      select coalesce(jsonb_agg(jsonb_build_object('key', p.name_key, 'name', p.name,
               'titles', (select jsonb_agg(x.title) from (
                  select t.title from tracks t
                  where t.notes like 'Feature on %' and lower(sc_guest_name(t.notes)) = p.name_key
                  order by t.id limit 3) x))), '[]'::jsonb)
      from top p));
end;
$$;

-- Every 30 minutes: one new artist, if today's allowance has room.
-- Guests already confirmed on Spotify first (they have songs here), then
-- similar artists.
create or replace function sc_grow_artists()
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  g guest_artists%rowtype;
  r record;
  v text;
  v_name text;
  v_mentions int;
  v_why text;
begin
  if sc_new_artists_left() <= 0 then return null; end if;

  select * into g from guest_artists
  where state = 'pending' and songs > 0 and spotify_artist_id is not null
  order by host_weight desc, songs desc, name
  limit 1;
  if g.name_key is not null then
    return sc_guest_result((select value from sc_private_settings where key = 'cron_secret'), g.name_key, 'create', null, g.spotify_artist_id, null, null);
  end if;

  -- The first similar artist that really isn't here under another spelling.
  for r in select * from sc_related_candidates(10) loop
    if sc_find_artist(r.name) is null then
      v_name := r.name; v_mentions := r.mentions; v_why := r.why;
      exit;
    end if;
  end loop;
  if v_name is null then return null; end if;
  v := trim(both '-' from lower(regexp_replace(v_name, '[^a-zA-Z0-9]+', '-', 'g'))) || '-' || substr(gen_random_uuid()::text, 1, 8);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('static_cuts.batch_id', '', true);
  perform sc_begin_batch('guests', 'New artist page: ' || v_name || ' (similar to ' || v_mentions || ' artists here)');
  insert into artists (id, name, status, lastfm_name) values (v, v_name, 'ONGOING', v_name);
  insert into artist_additions (artist_id, name, source, note)
  values (v, v_name, 'related', 'Similar to ' || left(v_why, 300));
  return v;
end;
$$;
revoke execute on function sc_grow_artists(), sc_artist_existing_work(text), sc_catalogue_sweep_done(),
  sc_new_artists_left(), sc_related_candidates(integer) from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'artist-growth';
select cron.schedule('artist-growth', '13,43 * * * *', 'select public.sc_grow_artists()');

-- Where things stand, for the artist queue page.
create or replace function rpc_growth_status()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_total int;
  v_genius int;
  v_lastfm int;
  v_left int;
begin
  if not is_moderator() then raise exception 'not authorized'; end if;
  select count(*) into v_total from artists where not catalogue_hold;
  select count(distinct r.artist_id) into v_genius from import_runs r join artists a on a.id = r.artist_id and not a.catalogue_hold
  where r.source = 'genius' and r.started_at > now() - interval '14 days';
  select count(distinct r.artist_id) into v_lastfm from import_runs r join artists a on a.id = r.artist_id and not a.catalogue_hold
  where r.source = 'lastfm' and r.started_at > now() - interval '14 days';
  v_left := sc_new_artists_left();
  return jsonb_build_object(
    'artists', v_total,
    'genius_checked', v_genius,
    'lastfm_checked', v_lastfm,
    'sweep_done', v_genius >= v_total and v_lastfm >= v_total,
    'held', sc_hold_new_catalogues(),
    'per_day', coalesce((select nullif(value, '')::int from sc_private_settings where key = 'new_artists_per_day'), 10),
    'left_today', v_left,
    'waiting_guests', (select count(*) from guest_artists where state = 'pending' and songs > 0 and spotify_artist_id is not null),
    'related', (select count(*) from sc_related_candidates(200)),
    'recent', (select coalesce(jsonb_agg(jsonb_build_object('artist_id', x.artist_id, 'name', x.name, 'source', x.source,
                 'note', x.note, 'at', x.created_at) order by x.created_at desc), '[]'::jsonb)
               from (select * from artist_additions order by created_at desc limit 20) x)
  );
end;
$$;
grant execute on function rpc_growth_status() to authenticated;

-- ---------------------------------------------------------------------------
-- Undo history: automatic jobs keep 14 days (people's changes keep 60)
-- ---------------------------------------------------------------------------
create or replace function sc_trim_undo()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  n int;
begin
  with gone as (
    delete from change_batches
    where created_by is null and created_at < now() - interval '14 days'
    returning 1
  )
  select count(*) into n from gone;
  return n;
end;
$$;
revoke execute on function sc_trim_undo() from public, anon, authenticated;
select cron.unschedule(jobid) from cron.job where jobname = 'undo-trim';
select cron.schedule('undo-trim', '35 4 * * *', 'select public.sc_trim_undo()');
