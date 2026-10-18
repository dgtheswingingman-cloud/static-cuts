-- Guest artists get pages automatically, checked against Spotify.
--
-- Imports file songs where our artist is only featured under our artist,
-- with a note like "Feature on Trippie Redd's song." (guest_artists keeps a
-- list of those names). A timer (guest-artists function, every 10 minutes,
-- 8 names a run, paced for Spotify) looks each name up on Spotify:
--   - it's the same Spotify artist as someone already here ("Ye" = Kanye
--     West): the songs move to that page
--   - an exact name match with at least 1,000 followers AND one of their
--     songs here is on Spotify under that artist: a page is made (with the
--     Spotify profile linked) and the songs move to it
--   - anything else waits on /review/guests for you to add or skip.
-- Moved songs stay on the original artist's page as a feature. Each move is
-- in the undo history. Names already resolved are applied again whenever
-- new imports mention them.

create table if not exists guest_artists (
  name_key text primary key,
  name text not null,
  songs int not null default 0,
  state text not null default 'pending' check (state in ('pending', 'created', 'linked', 'review', 'skipped')),
  artist_id text references artists (id) on delete set null,
  spotify_artist_id text,
  note text,
  checked_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table guest_artists enable row level security;
drop policy if exists guest_artists_read on guest_artists;
create policy guest_artists_read on guest_artists for select using ((select is_moderator()));
revoke insert, update, delete on guest_artists from anon, authenticated;

create or replace function sc_guest_name(p_notes text)
returns text
language sql
immutable
as $$
  select trim(substring(p_notes from '(?:^|\n)Feature on (.+?)''s song\.'));
$$;

-- Move a guest's songs onto their page (new or existing).
create or replace function sc_guest_move(p_key text, p_artist text)
returns int
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  t record;
  n int := 0;
begin
  for t in select id, artist_id, notes from tracks
           where notes like 'Feature on %' and lower(sc_guest_name(notes)) = p_key loop
    -- (Already on the right page, e.g. Kanye songs Genius credits to "Ye":
    -- just drop the "feature" tag and note.)
    update tracks set artist_id = p_artist, is_featured = false,
           notes = nullif(trim(regexp_replace(notes, '(^|\n)Feature on .+?''s song\.', '', 'g')), '')
    where id = t.id;
    if t.artist_id <> p_artist then
      insert into track_appearances (track_id, artist_id) values (t.id, t.artist_id) on conflict do nothing;
    end if;
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- Refresh the list from the notes; re-apply names already resolved.
create or replace function sc_guest_refresh()
returns int
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  g record;
  n int := 0;
begin
  insert into guest_artists (name_key, name, songs)
  select lower(nm), min(nm), count(*)
  from (select sc_guest_name(notes) nm from tracks where notes like 'Feature on %') x
  where nm is not null and nm <> ''
  group by lower(nm)
  on conflict (name_key) do update set songs = excluded.songs, updated_at = now();
  -- Names nobody mentions any more.
  update guest_artists g set songs = 0
  where g.songs > 0 and not exists (select 1 from tracks where notes like 'Feature on %' and lower(sc_guest_name(notes)) = g.name_key);
  for g in select * from guest_artists where artist_id is not null and songs > 0 loop
    perform set_config('static_cuts.batch_id', '', true);
    perform sc_begin_batch('guests', 'Songs moved to ' || g.name || '''s page');
    n := n + sc_guest_move(g.name_key, g.artist_id);
    update guest_artists set songs = 0 where name_key = g.name_key;
  end loop;
  return n;
end;
$$;

-- Called by the guest-artists function with the timer's password.
create or replace function sc_guest_next(p_secret text, p_limit int default 8)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then
    raise exception 'not authorized';
  end if;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform sc_guest_refresh();
  return jsonb_build_object(
    'known', (select coalesce(jsonb_object_agg(spotify_artist_id, id), '{}'::jsonb) from artists where spotify_artist_id is not null),
    'guests', (select coalesce(jsonb_agg(jsonb_build_object('key', g.name_key, 'name', g.name,
                 'titles', (select jsonb_agg(t.title) from (select title from tracks where notes like 'Feature on %'
                            and lower(sc_guest_name(notes)) = g.name_key limit 3) t))), '[]'::jsonb)
               from (select * from guest_artists where state = 'pending' and songs > 0
                     order by songs desc, name limit greatest(1, least(coalesce(p_limit, 8), 20))) g));
end;
$$;

-- Results from the function: action 'link' (artist_id), 'create'
-- (spotify id + name) or 'review' (note).
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
    update guest_artists set state = 'review', note = p_note, checked_at = now() where name_key = p_key;
    return null;
  end if;
  if p_action = 'link' then
    v_artist := p_artist;
  else
    v_artist := coalesce((select id from artists where spotify_artist_id = p_spotify_id limit 1), sc_find_artist(g.name));
    if v_artist is null then
      v_artist := lower(regexp_replace(coalesce(p_spotify_name, g.name), '[^a-zA-Z0-9]+', '-', 'g'))
                  || '-' || substr(gen_random_uuid()::text, 1, 8);
      v_artist := trim(both '-' from v_artist);
      perform set_config('static_cuts.batch_id', '', true);
      perform sc_begin_batch('guests', 'New artist page: ' || coalesce(p_spotify_name, g.name));
      insert into artists (id, name, status, spotify_artist_id) values (v_artist, coalesce(p_spotify_name, g.name), 'ONGOING', p_spotify_id);
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

-- Moderators: the review list, and add / skip / link by hand.
create or replace function admin_guest_artists()
returns table (name_key text, name text, songs int, state text, note text, sample text[])
language sql
stable
security definer
set search_path to 'public'
as $$
  select g.name_key, g.name, g.songs, g.state, g.note,
         (select array_agg(x) from (select a.name || ': ' || t.title x from tracks t join artists a on a.id = t.artist_id
            where t.notes like 'Feature on %' and lower(sc_guest_name(t.notes)) = g.name_key limit 3) s)
  from guest_artists g
  where is_moderator() and g.songs > 0 and g.state in ('review', 'pending')
  order by (g.state = 'review') desc, g.songs desc, g.name;
$$;

create or replace function admin_guest_action(p_key text, p_action text, p_artist text default null)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  g guest_artists%rowtype;
  v_artist text;
begin
  if not is_moderator() then raise exception 'not authorized'; end if;
  select * into g from guest_artists where name_key = p_key;
  if g.name_key is null then raise exception 'unknown name'; end if;
  if p_action = 'skip' then
    update guest_artists set state = 'skipped' where name_key = p_key;
    return null;
  end if;
  if p_action = 'link' then
    if not exists (select 1 from artists where id = p_artist) then raise exception 'pick an artist'; end if;
    v_artist := p_artist;
  else
    v_artist := sc_find_artist(g.name);
    if v_artist is null then
      perform set_config('static_cuts.batch_id', '', true);
      perform sc_begin_batch('guests', 'New artist page: ' || g.name);
      v_artist := trim(both '-' from lower(regexp_replace(g.name, '[^a-zA-Z0-9]+', '-', 'g'))) || '-' || substr(gen_random_uuid()::text, 1, 8);
      insert into artists (id, name, status) values (v_artist, g.name, 'ONGOING');
    end if;
  end if;
  perform set_config('static_cuts.batch_id', '', true);
  perform sc_begin_batch('guests', 'Songs moved to ' || g.name || '''s page');
  perform sc_guest_move(p_key, v_artist);
  update guest_artists set state = case when p_action = 'link' then 'linked' else 'created' end, artist_id = v_artist, songs = 0
  where name_key = p_key;
  return v_artist;
end;
$$;

revoke execute on function sc_guest_move(text, text), sc_guest_refresh(), sc_guest_next(text, int),
  sc_guest_result(text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function sc_guest_next(text, int), sc_guest_result(text, text, text, text, text, text, text) to service_role;
revoke execute on function admin_guest_artists(), admin_guest_action(text, text, text) from public, anon;
grant execute on function admin_guest_artists(), admin_guest_action(text, text, text) to authenticated;

-- First fill of the list.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select sc_guest_refresh();

select cron.unschedule('guest-artists') where exists (select 1 from cron.job where jobname = 'guest-artists');
select cron.schedule('guest-artists', '8-59/10 * * * *', $job$
  select net.http_post(
    url := 'https://pcuyzaamcsegblrauxsa.supabase.co/functions/v1/guest-artists',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select value from public.sc_private_settings where key = 'cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000);
$job$);

select count(*) guests, sum(songs) songs from guest_artists;
