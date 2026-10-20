-- Tester pack (run after 20261022000000_launch_pack.sql):
--  1. Deleted songs stay deleted: Genius / Last.fm imports won't suggest a
--     song again after it was deleted or merged away.
--  2. "Since your last visit" for followed (or picked) artists.
--  3. Spotify sign-in: tick the artists you follow there (one ticket per
--     call from the shared Spotify allowance).
--  4. Download your data / delete your account.
--  5. Tracker safety: a tracker whose columns change is paused for a look,
--     and an unusually big batch of status changes is held for review.

-- ----------------------------------------------------------------- 1

create table if not exists import_forgotten_titles (
  artist_id text not null,
  title_key text not null,
  forgotten_at timestamptz not null default now(),
  primary key (artist_id, title_key)
);
alter table import_forgotten_titles enable row level security;
revoke all on import_forgotten_titles from anon, authenticated;

create or replace function sc_forget_deleted_track()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if old.artist_id is not null and sc_title_key(old.title) is not null then
    insert into import_forgotten_titles (artist_id, title_key)
    values (old.artist_id, sc_title_key(old.title))
    on conflict do nothing;
  end if;
  return null;
end;
$$;
revoke execute on function sc_forget_deleted_track() from public, anon, authenticated;

drop trigger if exists tracks_forget_deleted on tracks;
create trigger tracks_forget_deleted after delete on tracks
  for each row execute function sc_forget_deleted_track();

-- Songs deleted before today (from the undo history, last 6 months).
insert into import_forgotten_titles (artist_id, title_key, forgotten_at)
select c.old_row ->> 'artist_id', sc_title_key(c.old_row ->> 'title'), min(c.created_at)
from change_log c
where c.table_name = 'tracks' and c.op = 'DELETE'
  and c.old_row ->> 'artist_id' is not null and sc_title_key(c.old_row ->> 'title') is not null
group by 1, 2
on conflict do nothing;

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
  v_song text;
  v_suggested int := 0;
  v_skipped int := 0;
begin
  select * into r from import_runs where id = p_run;
  if r.id is null or r.finished_at is not null then raise exception 'import run not active'; end if;

  create temp table if not exists _sc_known2 (k text) on commit drop;
  truncate _sc_known2;
  insert into _sc_known2 select k from sc_known_keys(r.artist_id);
  insert into _sc_known2
  select sc_title_key(d.title || coalesce(' (' || d.version_hint || ')', ''))
  from discoveries d where (d.artist_id = r.artist_id or d.main_artist_id = r.artist_id) and d.state = 'open';
  insert into _sc_known2
  select sc_song_key(d.title || coalesce(' (' || d.version_hint || ')', ''))
  from discoveries d where (d.artist_id = r.artist_id or d.main_artist_id = r.artist_id) and d.state = 'open';
  -- Songs that were deleted or merged away: don't bring them back.
  insert into _sc_known2 select f.title_key from import_forgotten_titles f where f.artist_id = r.artist_id;

  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_key := sc_title_key(it ->> 'title');
    v_song := sc_song_key(it ->> 'title');
    if v_key is null or v_key = ''
       or exists (select 1 from _sc_known2 where k in (v_key, v_song)) then
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
    insert into _sc_known2 values (v_key), (v_song);
  end loop;

  update import_runs set suggested = suggested + v_suggested, skipped = skipped + v_skipped where id = p_run;
  return jsonb_build_object('suggested', v_suggested, 'skipped', v_skipped);
end;
$$;

-- ----------------------------------------------------------------- 2

-- What changed for your artists since a time (at most 30 days back):
-- followed artists when signed in, or the given ids (first-visit picks).
create or replace function rpc_since_last_visit(p_since timestamptz, p_artist_ids text[] default null)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  with lim as (
    select greatest(coalesce(p_since, now() - interval '7 days'), now() - interval '30 days') since
  ),
  mine as (
    select f.artist_id from follows f where f.user_id = auth.uid() and p_artist_ids is null
    union
    select x from unnest(coalesce(p_artist_ids[1:50], '{}')) x
  ),
  ev as (
    select t.artist_id, 'added' kind from tracks t, lim
    where t.artist_id in (select artist_id from mine) and t.created_at >= lim.since and t.parent_track_id is null
    union all
    -- From unconfirmed to anything is us catching up ("checked"), not news.
    select t.artist_id, case when coalesce(e.from_status, 'unconfirmed') = 'unconfirmed' then 'checked'
                             when e.to_status in ('leaked', 'released') then e.to_status
                             when e.to_status = 'snippet' and e.from_status in ('rumored', 'teased', 'announced') then 'snippet'
                             else 'changed' end
    from track_status_events e join tracks t on t.id = e.track_id, lim
    where t.artist_id in (select artist_id from mine) and e.created_at >= lim.since
      and e.to_status is distinct from e.from_status
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'artist_id', g.artist_id, 'artist', a.name, 'added', g.added, 'leaked', g.leaked,
           'released', g.released, 'snippet', g.snippet, 'changed', g.changed, 'checked', g.checked)
         order by g.leaked + g.released + g.snippet desc, g.added desc, g.checked desc), '[]'::jsonb)
  from (
    select artist_id,
           count(*) filter (where kind = 'added') added, count(*) filter (where kind = 'leaked') leaked,
           count(*) filter (where kind = 'released') released, count(*) filter (where kind = 'snippet') snippet,
           count(*) filter (where kind = 'changed') changed, count(*) filter (where kind = 'checked') checked
    from ev group by artist_id
  ) g join artists a on a.id = g.artist_id;
$$;
grant execute on function rpc_since_last_visit(timestamptz, text[]) to anon, authenticated;

-- ----------------------------------------------------------------- 3a

-- Guest artists: keep the Spotify profile found for one sent to review, and
-- use it when a moderator adds or links them (so the page's Spotify import
-- works straight away).
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
    v_artist := coalesce((select id from artists where g.spotify_artist_id is not null and spotify_artist_id = g.spotify_artist_id limit 1),
                         sc_find_artist(g.name));
    if v_artist is null then
      perform set_config('static_cuts.batch_id', '', true);
      perform sc_begin_batch('guests', 'New artist page: ' || g.name);
      v_artist := trim(both '-' from lower(regexp_replace(g.name, '[^a-zA-Z0-9]+', '-', 'g'))) || '-' || substr(gen_random_uuid()::text, 1, 8);
      insert into artists (id, name, status, spotify_artist_id) values (v_artist, g.name, 'ONGOING', g.spotify_artist_id);
    end if;
  end if;
  -- Fill in the Spotify profile if the page doesn't have one yet.
  if g.spotify_artist_id is not null
     and not exists (select 1 from artists where spotify_artist_id = g.spotify_artist_id and id <> v_artist) then
    update artists set spotify_artist_id = g.spotify_artist_id where id = v_artist and spotify_artist_id is null;
  end if;
  perform set_config('static_cuts.batch_id', '', true);
  perform sc_begin_batch('guests', 'Songs moved to ' || g.name || '''s page');
  perform sc_guest_move(p_key, v_artist);
  update guest_artists set state = case when p_action = 'link' then 'linked' else 'created' end, artist_id = v_artist, songs = 0
  where name_key = p_key;
  return v_artist;
end;
$$;

-- ----------------------------------------------------------------- 3b

-- Signed in with Spotify: the first-visit page asks Spotify (with the
-- person's own sign-in) who they follow, at most 4 calls each time and 8 an
-- hour per person, each taking a ticket from the shared Spotify allowance.
create table if not exists spotify_user_calls (
  user_id uuid not null,
  at timestamptz not null default now()
);
create index if not exists spotify_user_calls_user on spotify_user_calls (user_id, at);
alter table spotify_user_calls enable row level security;
revoke all on spotify_user_calls from anon, authenticated;

create or replace function rpc_spotify_ticket()
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null then return false; end if;
  if (select count(*) from spotify_user_calls where user_id = auth.uid() and at > now() - interval '1 hour') >= 8 then
    return false;
  end if;
  if exists (select 1 from sc_private_settings where key = 'spotify_pause_until' and value::timestamptz > now()) then
    return false;
  end if;
  if sc_spotify_allow(1) <> 1 then return false; end if;
  insert into spotify_user_calls (user_id) values (auth.uid());
  return true;
end;
$$;
revoke execute on function rpc_spotify_ticket() from public, anon;
grant execute on function rpc_spotify_ticket() to authenticated;

-- Spotify artist ids -> our artist ids.
create or replace function rpc_artists_by_spotify(p_ids text[])
returns setof text
language sql
stable
security definer
set search_path to 'public'
as $$
  select a.id from artists a where a.spotify_artist_id = any (p_ids[1:200]);
$$;
grant execute on function rpc_artists_by_spotify(text[]) to anon, authenticated;

-- ----------------------------------------------------------------- 4

-- Everything you've put in, as one file (Settings -> Your data).
create or replace function rpc_my_data()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select case when auth.uid() is null then null else jsonb_build_object(
    'exported_at', now(),
    'account', (select jsonb_build_object('id', u.id, 'email', u.email, 'joined', u.created_at) from auth.users u where u.id = auth.uid()),
    'profile', (select to_jsonb(p) from profiles p where p.id = auth.uid()),
    'following', (select coalesce(jsonb_agg(jsonb_build_object('artist', a.name, 'artist_id', f.artist_id, 'since', f.followed_at)), '[]')
                  from follows f left join artists a on a.id = f.artist_id where f.user_id = auth.uid()),
    'collection', (select coalesce(jsonb_agg(jsonb_build_object('song', t.title, 'artist', a.name, 'song_id', o.track_id, 'collected', o.collected_at)), '[]')
                   from track_ownership o left join tracks t on t.id = o.track_id left join artists a on a.id = t.artist_id where o.user_id = auth.uid()),
    'ratings', (select coalesce(jsonb_agg(jsonb_build_object('song', t.title, 'song_id', r.track_id, 'rating', r.value, 'at', r.updated_at)), '[]')
                from ratings r left join tracks t on t.id = r.track_id where r.user_id = auth.uid()),
    'comments', (select coalesce(jsonb_agg(jsonb_build_object('song_id', c.track_id, 'text', c.body, 'at', c.created_at)), '[]')
                 from comments c where c.user_id = auth.uid()),
    'lists', (select coalesce(jsonb_agg(jsonb_build_object('title', l.title, 'description', l.description, 'public', l.is_public,
                'songs', (select coalesce(jsonb_agg(jsonb_build_object('song', t.title, 'song_id', i.track_id, 'note', i.note) order by i.position), '[]')
                          from song_list_items i left join tracks t on t.id = i.track_id where i.list_id = l.id))), '[]')
              from song_lists l where l.owner_id = auth.uid()),
    'suggestions', (select coalesce(jsonb_agg(jsonb_build_object('type', s.type, 'details', s.payload, 'status', s.status, 'at', s.created_at)), '[]')
                    from submissions s where s.submitted_by = auth.uid()),
    'reminders', (select coalesce(jsonb_agg(jsonb_build_object('song_id', w.track_id, 'at', w.created_at)), '[]')
                  from radar_watches w where w.user_id = auth.uid()),
    'most_wanted_votes', (select coalesce(jsonb_agg(jsonb_build_object('song_id', v.track_id, 'at', v.created_at)), '[]')
                          from wanted_votes v where v.user_id = auth.uid())
  ) end;
$$;
revoke execute on function rpc_my_data() from public, anon;
grant execute on function rpc_my_data() to authenticated;

-- Delete your account. Your follows, collection, ratings, lists, votes and
-- settings go with it. Songs and fixes you suggested that were approved stay
-- in the archive without your name; your comments are blanked out (replies
-- to them stay readable).
create or replace function rpc_delete_my_account(p_confirm text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if is_admin() then raise exception 'The admin account can''t be deleted from here.'; end if;
  if coalesce(p_confirm, '') <> 'delete my account' then raise exception 'Type "delete my account" to confirm.'; end if;
  update comments set body = '[deleted]', user_id = null where user_id = me;
  update submissions set submitted_by = null where submitted_by = me;
  update submissions set reviewed_by = null where reviewed_by = me;
  update artist_genre_tags set created_by = null where created_by = me;
  delete from artist_genre_tag_votes where user_id = me;
  delete from auth.users where id = me;
  return true;
end;
$$;
revoke execute on function rpc_delete_my_account(text) from public, anon;
grant execute on function rpc_delete_my_account(text) to authenticated;

-- ----------------------------------------------------------------- 5

-- Tracker safety. The column names the tracker had when it was set up, to
-- spot a rearranged sheet before reading it wrong.
alter table sheet_sources add column if not exists header_check jsonb;

-- A tracker that needs a look: stop re-checking it and tell the admins.
create or replace function sc_sheet_hold(p_source uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  src sheet_sources%rowtype;
begin
  select * into src from sheet_sources where id = p_source;
  if src.id is null then return; end if;
  update sheet_sources set auto_sync = false, last_synced_at = now(),
         last_result = jsonb_build_object('error', p_reason, 'held', true)
  where id = p_source;
  insert into notifications (user_id, kind, title, body, link, dedupe_key)
  select a, 'admin', 'Tracker paused: ' || coalesce(src.title, 'a tracker'), left(p_reason, 200),
         '/admin/health', 'tracker-hold:' || src.id || ':' || to_char(now(), 'YYYY-MM-DD')
  from sc_admin_ids(false) a
  on conflict do nothing;
end;
$$;
revoke execute on function sc_sheet_hold(uuid, text) from public, anon, authenticated;

create or replace function sc_sheet_reconcile(p_source uuid, p_home text, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  src sheet_sources%rowtype;
  it jsonb;
  v_ids text[];
  v_key text;
  t tracks%rowtype;
  v_status text;
  v_leak date;
  v_rel date;
  v_batch boolean := false;
  v_statuses int := 0;
  v_filled int := 0;
  v_disagree int := 0;
  v_same int := 0;
  v_n int;
begin
  select * into src from sheet_sources where id = p_source;
  if src.id is null then raise exception 'unknown sheet'; end if;

  perform set_config('static_cuts.credit_user', '', true);
  perform set_config('static_cuts.status_note', 'From ' || coalesce(src.title, 'a community tracker'), true);

  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    -- The song this row is about: same tidied title on this artist's page,
    -- preferring a main song when a version shares the name.
    -- (The key is worked out once here: inside the query it was re-worked
    -- for every song on the page, which timed out on big trackers.)
    v_key := sc_title_key(it ->> 'title');
    continue when v_key is null or v_key = '';
    select array_agg(tk.track_id order by tk.is_main desc) into v_ids
    from track_title_keys tk
    where tk.artist_id = p_home and tk.key = v_key;
    continue when v_ids is null;
    -- Two main songs with the same name: too unsure to touch either.
    continue when cardinality(v_ids) > 1
      and (select count(*) from track_title_keys where track_id = any (v_ids) and is_main) > 1;
    select * into t from tracks where id = v_ids[1];
    continue when t.id is null;

    v_status := it ->> 'status_guess';
    if v_status not in ('rumored', 'teased', 'snippet', 'leaked', 'announced', 'released') then v_status := null; end if;
    v_leak := nullif(it -> 'extra' ->> 'leak_date', '')::date;
    v_rel := nullif(it ->> 'release_date', '')::date;

    -- One undo-history batch per run, started only once something changes.
    if not v_batch and (
         (v_status is not null and coalesce(t.release_status, 'unconfirmed') = 'unconfirmed')
      or (v_status is not null and t.release_status = v_status and t.status_source is null)
      or (t.leak_date is null and v_leak is not null)
      or (t.album is null and nullif(it ->> 'album', '') is not null)
      or (t.notes is null and nullif(it -> 'extra' ->> 'notes', '') is not null)
      or (t.producers is null and nullif(it -> 'extra' ->> 'producers', '') is not null)
      or (t.featured_artists is null and nullif(it -> 'extra' ->> 'featuring', '') is not null)) then
      perform sc_begin_batch('tracker', 'Tracker update: ' || coalesce(src.title, 'community tracker'));
      v_batch := true;
    end if;

    -- Status.
    if v_status is not null then
      if coalesce(t.release_status, 'unconfirmed') = 'unconfirmed' then
        update tracks set release_status = v_status, status_source = src.title, status_source_url = src.url
        where id = t.id;
        v_statuses := v_statuses + 1;
      elsif t.release_status = v_status then
        v_same := v_same + 1;
        if t.status_source is null then
          update tracks set status_source = src.title, status_source_url = src.url where id = t.id;
        end if;
      elsif t.release_status = 'released' and coalesce(t.spotify_url, '') like '%open.spotify.com%' then
        null; -- Spotify says it's out; a spreadsheet doesn't overrule that.
      else
        insert into tracker_disagreements (track_id, source_id, current_status, tracker_status, tracker_title)
        values (t.id, src.id, t.release_status, v_status, it ->> 'title')
        on conflict (track_id, source_id, tracker_status) do nothing;
        get diagnostics v_n = row_count;
        v_disagree := v_disagree + v_n;
      end if;
    end if;

    -- Empty details only.
    update tracks set
      leak_date = coalesce(leak_date, v_leak),
      album = coalesce(album, nullif(it ->> 'album', '')),
      release_date = coalesce(release_date, case when coalesce(v_status, release_status) = 'released' then v_rel end),
      notes = coalesce(notes, nullif(it -> 'extra' ->> 'notes', '')),
      producers = coalesce(producers, nullif(it -> 'extra' ->> 'producers', '')),
      featured_artists = coalesce(featured_artists, nullif(it -> 'extra' ->> 'featuring', ''))
    where id = t.id
      and ((leak_date is null and v_leak is not null)
        or (album is null and nullif(it ->> 'album', '') is not null)
        or (release_date is null and v_rel is not null and coalesce(v_status, release_status) = 'released')
        or (notes is null and nullif(it -> 'extra' ->> 'notes', '') is not null)
        or (producers is null and nullif(it -> 'extra' ->> 'producers', '') is not null)
        or (featured_artists is null and nullif(it -> 'extra' ->> 'featuring', '') is not null));
    get diagnostics v_n = row_count;
    v_filled := v_filled + v_n;
  end loop;

  -- Re-checks normally change a handful of songs. Hundreds at once usually
  -- means the sheet was rearranged: undo this whole run and hold the
  -- tracker for a look (the first import, and one pressed by hand after a
  -- hold, are allowed through).
  if src.last_result ? 'statuses' and v_statuses + v_disagree > 150 then
    raise exception 'Held for a look: this re-check would have changed % statuses at once, far more than usual. Nothing was changed.',
      v_statuses + v_disagree;
  end if;

  perform set_config('static_cuts.status_note', '', true);
  return jsonb_build_object('statuses', v_statuses, 'details', v_filled, 'disagree', v_disagree, 'agreed', v_same);
end;
$$;
revoke execute on function sc_sheet_reconcile(uuid, text, jsonb) from public, anon, authenticated;
