-- Control room pack (run after 20261022020000_tester_pack.sql):
--  1. Roles: owner (the site's own account), admins, moderators. Choosing
--     the team, API keys, auto-approve rules and leak file links are owner
--     only.
--  2. Leak file links are owner only: kept privately on the song, never
--     shown as a public listen link.
--  3. Collab map: one artist's circle, and a path between two artists.
--  4. YouTube search: candidates from YouTube's search go to possible links.
--  5. One order for background work; finish existing artists before new
--     guest pages; guest artist editing.

-- ----------------------------------------------------------------- 1

alter table moderators add column if not exists role text not null default 'moderator';
alter table moderators drop constraint if exists moderators_role_check;
alter table moderators add constraint moderators_role_check check (role in ('moderator', 'admin'));

create or replace function is_owner()
returns boolean
language sql
stable
set search_path to 'public'
as $$
  select coalesce(auth.email() = 'dg.theswingingman@gmail.com', false) and not is_oauth_client();
$$;

create or replace function is_admin()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select is_owner()
      or (not is_oauth_client() and exists (select 1 from moderators where user_id = auth.uid() and role = 'admin'));
$$;

create or replace function rpc_my_role()
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select case when is_owner() then 'owner' when is_admin() then 'admin' when is_moderator() then 'moderator' end;
$$;

-- Admin notifications go to the owner and the admins.
create or replace function sc_admin_ids(p_include_mods boolean default false)
returns setof uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select id from auth.users where email = 'dg.theswingingman@gmail.com'
  union select user_id from moderators where role = 'admin' or p_include_mods;
$$;

-- Owner-only from now on: the team, API keys, auto-approve rules.
do $$
declare
  f text;
  d text;
begin
  foreach f in array array['admin_list_moderators()', 'admin_set_moderator(uuid,boolean,text)', 'admin_find_people(text)',
                           'admin_api_keys()', 'admin_create_api_key(text,integer,integer)', 'admin_revoke_api_key(uuid)',
                           'admin_set_auto_approve(jsonb)', 'admin_auto_approve_settings()'] loop
    d := pg_get_functiondef(f::regprocedure);
    if position('is_admin()' in d) > 0 then
      execute replace(d, 'is_admin()', 'is_owner()');
    end if;
  end loop;
end $$;

-- The team list, with each person's role.
drop function if exists admin_list_moderators();
create function admin_list_moderators()
returns table (user_id uuid, display_name text, avatar_url text, added_at timestamptz, note text, actions bigint, role text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select m.user_id, p.display_name, p.avatar_url, m.added_at, m.note,
         (select count(*) from change_batches b where b.created_by = m.user_id), m.role
  from moderators m left join profiles p on p.id = m.user_id
  where is_owner()
  order by m.role, m.added_at;
$$;
revoke execute on function admin_list_moderators() from public, anon;
grant execute on function admin_list_moderators() to authenticated;

create or replace function admin_set_role(p_user uuid, p_role text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not is_owner() then raise exception 'Only the owner can choose the team.'; end if;
  if p_user = auth.uid() then raise exception 'That''s you.'; end if;
  if p_role = 'none' then
    delete from moderators where user_id = p_user;
  elsif p_role in ('moderator', 'admin') then
    insert into moderators (user_id, role) values (p_user, p_role)
    on conflict (user_id) do update set role = excluded.role;
  else
    raise exception 'Unknown role.';
  end if;
end;
$$;
revoke execute on function admin_set_role(uuid, text) from public, anon;
grant execute on function admin_set_role(uuid, text) to authenticated;

-- Only the owner account can't be deleted from Settings (admins can leave).
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
  if is_owner() then raise exception 'The owner account can''t be deleted from here.'; end if;
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

-- ----------------------------------------------------------------- 2

-- Sites that host leaked files. Links to them are kept privately (owner
-- only) instead of being shown as a listen link. The owner edits the list in
-- Control room -> Owner.
create table if not exists leak_hosts (
  host text primary key,
  added_at timestamptz not null default now()
);
alter table leak_hosts enable row level security;
revoke all on leak_hosts from anon, authenticated;
insert into leak_hosts (host) values ('pillows.su') on conflict do nothing;

-- The private file links (owner only, through the functions below).
create table if not exists track_files (
  track_id text primary key references tracks (id) on delete cascade,
  url text not null,
  source text,
  added_at timestamptz not null default now()
);
alter table track_files enable row level security;
revoke all on track_files from anon, authenticated;

-- Public: only whether a file is known to exist, never where.
alter table tracks add column if not exists has_file boolean not null default false;

create or replace function sc_url_host(p_url text)
returns text
language sql
immutable
as $$
  select lower(substring(coalesce(p_url, '') from '^[a-zA-Z]+://(?:www\.)?([^/:?#]+)'));
$$;

create or replace function sc_is_leak_url(p_url text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (select 1 from leak_hosts h
                 where sc_url_host(p_url) = h.host or sc_url_host(p_url) like '%.' || h.host);
$$;
revoke execute on function sc_is_leak_url(text) from public, anon, authenticated;

-- A leak link put on a song (by a tracker, an import, a suggestion being
-- approved or an edit) goes into the private box instead.
create or replace function sc_tracks_keep_leak_private()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.spotify_url is not null and sc_is_leak_url(new.spotify_url) then
    insert into track_files (track_id, url, source) values (new.id, new.spotify_url, 'listen link')
    on conflict (track_id) do update set url = excluded.url;
    new.spotify_url := null;
    new.has_file := true;
  end if;
  return new;
end;
$$;
revoke execute on function sc_tracks_keep_leak_private() from public, anon, authenticated;

-- (track_files needs the song to exist, so new songs are handled after insert.)
create or replace function sc_tracks_keep_leak_private_new()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.spotify_url is not null and sc_is_leak_url(new.spotify_url) then
    insert into track_files (track_id, url, source) values (new.id, new.spotify_url, 'listen link')
    on conflict (track_id) do update set url = excluded.url;
    update tracks set spotify_url = null, has_file = true where id = new.id;
  end if;
  return null;
end;
$$;
revoke execute on function sc_tracks_keep_leak_private_new() from public, anon, authenticated;

drop trigger if exists tracks_keep_leak_private on tracks;
create trigger tracks_keep_leak_private before update of spotify_url on tracks
  for each row execute function sc_tracks_keep_leak_private();
drop trigger if exists tracks_keep_leak_private_new on tracks;
create trigger tracks_keep_leak_private_new after insert on tracks
  for each row execute function sc_tracks_keep_leak_private_new();

-- Possible links to leak sites: kept privately too, never offered for votes.
create or replace function sc_candidates_keep_leak_private()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if sc_is_leak_url(new.url) then
    insert into track_files (track_id, url, source) values (new.track_id, new.url, coalesce(new.source, 'suggestion'))
    on conflict (track_id) do nothing;
    update tracks set has_file = true where id = new.track_id and not has_file;
    return null;
  end if;
  return new;
end;
$$;
revoke execute on function sc_candidates_keep_leak_private() from public, anon, authenticated;
drop trigger if exists link_candidates_keep_leak_private on track_link_candidates;
create trigger link_candidates_keep_leak_private before insert on track_link_candidates
  for each row execute function sc_candidates_keep_leak_private();

-- Move what's already there (in the undo history as one batch).
create or replace function sc_sweep_leak_links()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  n int;
  m int;
begin
  insert into track_files (track_id, url, source)
  select t.id, t.spotify_url, 'listen link' from tracks t where t.spotify_url is not null and sc_is_leak_url(t.spotify_url)
  on conflict (track_id) do nothing;
  perform sc_begin_batch('leak-links', 'Leak file links made private');
  update tracks set spotify_url = null, has_file = true where spotify_url is not null and sc_is_leak_url(spotify_url);
  get diagnostics n = row_count;
  insert into track_files (track_id, url, source)
  select c.track_id, c.url, coalesce(c.source, 'suggestion') from track_link_candidates c where sc_is_leak_url(c.url)
  on conflict (track_id) do nothing;
  update tracks t set has_file = true from track_link_candidates c where c.track_id = t.id and sc_is_leak_url(c.url) and not t.has_file;
  delete from track_link_candidates c where sc_is_leak_url(c.url);
  get diagnostics m = row_count;
  perform set_config('static_cuts.batch_id', '', true);
  return n + m;
end;
$$;
revoke execute on function sc_sweep_leak_links() from public, anon, authenticated;

select sc_sweep_leak_links() as leak_links_made_private;

-- Owner: the private link for one song.
create or replace function owner_track_file(p_track_id text)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select case when is_owner() then (select jsonb_build_object('url', f.url, 'source', f.source, 'added_at', f.added_at)
                                     from track_files f where f.track_id = p_track_id) end;
$$;
revoke execute on function owner_track_file(text) from public, anon;
grant execute on function owner_track_file(text) to authenticated;

-- Owner: the leak site list, with how many private links each has.
create or replace function owner_leak_hosts()
returns table (host text, links bigint, added_at timestamptz)
language sql
stable
security definer
set search_path to 'public'
as $$
  select h.host, (select count(*) from track_files f where sc_url_host(f.url) = h.host or sc_url_host(f.url) like '%.' || h.host), h.added_at
  from leak_hosts h where is_owner() order by h.host;
$$;
revoke execute on function owner_leak_hosts() from public, anon;
grant execute on function owner_leak_hosts() to authenticated;

-- Owner: add or remove a leak site. Adding one moves its existing links into
-- the private box straight away.
create or replace function owner_set_leak_host(p_host text, p_on boolean)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  h text := lower(regexp_replace(trim(coalesce(p_host, '')), '^([a-z]+://)?(www\.)?([^/:?#]+).*$', '\3', 'i'));
begin
  if not is_owner() then raise exception 'Only the owner can change this.'; end if;
  if h = '' or h !~ '\.' then raise exception 'Type a site like example.com.'; end if;
  if p_on then
    insert into leak_hosts (host) values (h) on conflict do nothing;
    return sc_sweep_leak_links();
  end if;
  delete from leak_hosts where host = h;
  return 0;
end;
$$;
revoke execute on function owner_set_leak_host(text, boolean) from public, anon;
grant execute on function owner_set_leak_host(text, boolean) to authenticated;


-- ----------------------------------------------------------------- 3

-- Collab map: the collaborations worked out once a night (and whenever an
-- admin asks) instead of on every visit (it took 2 seconds and growing).
create table if not exists collab_edges (
  x text not null,
  y text not null,
  guest_name text,
  songs int not null,
  tracks text[] not null default '{}',
  primary key (x, y)
);
alter table collab_edges enable row level security;
revoke all on collab_edges from anon, authenticated;

create or replace function sc_refresh_collab_edges()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_n int;
begin
  create temp table _ce on commit drop as
  with pairs as (
    select t.artist_id a_id, null::text a_name, ap.artist_id b_id, null::text b_name, t.id track_id
    from track_appearances ap join tracks t on t.id = ap.track_id
    where ap.artist_id <> t.artist_id
    union all
    select t.artist_id, null, null, n, t.id
    from tracks t, sc_split_names(t.featured_artists) n
    where t.featured_artists is not null and t.featured_artists <> ''
    union all
    select t.artist_id, null, null, n, t.id
    from tracks t, sc_split_names(substring(t.title from '(?i)\m(?:feat|ft)\.?\s+([^)\]]+)')) n
    where t.title ~* '\m(feat|ft)\.?\s'
  ),
  named as (
    select p.a_id, coalesce(p.b_id, a.id) b_id, case when coalesce(p.b_id, a.id) is null then p.b_name end b_name, p.track_id
    from pairs p
    left join lateral (select ar.id from artists ar where lower(ar.name) = lower(p.b_name) limit 1) a on p.b_name is not null
  )
  select least(a_id, coalesce(b_id, 'guest:' || lower(b_name))) x, greatest(a_id, coalesce(b_id, 'guest:' || lower(b_name))) y,
         max(b_name) guest_name, count(distinct track_id)::int songs, (array_agg(distinct track_id))[1:5] tracks
  from named
  where coalesce(b_id, '') <> a_id
  group by 1, 2;
  delete from collab_edges;
  insert into collab_edges select * from _ce;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke execute on function sc_refresh_collab_edges() from public, anon, authenticated;

select sc_refresh_collab_edges() as collab_edges;

-- Same answer as before, read from the nightly list.
create or replace function rpc_collab_graph(p_artist text default null)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  with filtered as (
    select * from collab_edges where p_artist is null or x = p_artist or y = p_artist
  ),
  nodes as (
    select k, count(*) degree, sum(songs) songs from (
      select x k, songs from filtered union all select y, songs from filtered) z group by k
  )
  select jsonb_build_object(
    'nodes', (select coalesce(jsonb_agg(jsonb_build_object(
                'key', n.k, 'artist_id', a.id,
                'name', coalesce(a.name, (select max(guest_name) from filtered where x = n.k or y = n.k), substr(n.k, 7)),
                'degree', n.degree, 'songs', n.songs)), '[]'::jsonb)
              from nodes n left join artists a on a.id = n.k),
    'edges', (select coalesce(jsonb_agg(jsonb_build_object('a', x, 'b', y, 'songs', songs, 'tracks', tracks)), '[]'::jsonb) from filtered),
    'updated_at', now());
$$;

select cron.schedule('collab-refresh', '41 4 * * *', $$ select public.sc_refresh_collab_edges(); $$);

-- ----------------------------------------------------------------- 5a

-- One order for background work. Every job that works through songs one
-- by one puts artists in this order: followers count most, then recent
-- "check this artist" requests. (Never song popularity.)
create or replace function sc_artist_weights()
returns table (artist_id text, weight int)
language sql
stable
security definer
set search_path to 'public'
as $$
  select a.id,
         10 * (select count(*) from follows f where f.artist_id = a.id)::int
       + 3 * (select count(*) from artist_requests r where r.artist_id = a.id and r.created_at > now() - interval '30 days')::int
  from artists a;
$$;
revoke execute on function sc_artist_weights() from public, anon, authenticated;

create or replace function sc_cover_next(p_secret text, p_limit integer default 20)
returns table (track_id text, spotify_url text)
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then
    raise exception 'not authorized';
  end if;
  return query
  select t.id, t.spotify_url from tracks t left join sc_artist_weights() w on w.artist_id = t.artist_id
  where t.spotify_url ~ '^https://open\.spotify\.com/(track|album)/'
    and t.cover_url is null
    and (t.cover_checked_at is null or t.cover_checked_at < now() - interval '30 days')
  order by coalesce(w.weight, 0) desc, t.created_at desc nulls last
  limit greatest(1, least(coalesce(p_limit, 20), 50));
end;
$$;

create or replace function sc_genius_credit_next(p_secret text, p_limit integer default 15)
returns table (track_id text, title text, artist text, genius_artist_id text, genius_song_id bigint)
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then
    raise exception 'not authorized';
  end if;
  return query
  select t.id, t.title, a.name, a.genius_artist_id, t.genius_song_id
  from tracks t join artists a on a.id = t.artist_id left join sc_artist_weights() w on w.artist_id = t.artist_id
  where (t.genius_checked_at is null or t.genius_checked_at < now() - interval '60 days')
    and (t.producers is null or t.featured_artists is null or t.cover_url is null)
  order by (t.genius_song_id is null), coalesce(w.weight, 0) desc,
           (t.parent_track_id is not null), (t.release_status in ('released', 'leaked')) desc, t.id
  limit greatest(1, least(coalesce(p_limit, 15), 40));
end;
$$;

create or replace function sc_spotify_match_next(p_limit integer default 10)
returns table (id text, title text, release_status text, album text, release_date date, artist text, others text[])
language sql
stable
security definer
set search_path to 'public'
as $$
  with todo as (
    select t.id, t.title, t.release_status, t.album, t.release_date, t.artist_id,
           row_number() over (partition by t.artist_id order by (t.parent_track_id is null) desc, t.id) turn
    from tracks t
    where t.spotify_url is null and t.spotify_search_attempted_at is null
  )
  select d.id, d.title, d.release_status, d.album, d.release_date, a.name,
         array(select a2.name from track_appearances ap join artists a2 on a2.id = ap.artist_id where ap.track_id = d.id)
  from todo d
  join artists a on a.id = d.artist_id
  left join sc_artist_weights() w on w.artist_id = d.artist_id
  order by (coalesce(w.weight, 0) > 0) desc, d.turn, coalesce(w.weight, 0) desc, d.artist_id
  limit greatest(1, least(coalesce(p_limit, 10), 50));
$$;

-- ----------------------------------------------------------------- 5b

-- Finish existing artists before making new pages: while followed artists
-- still have songs waiting for their Spotify or Genius check, guest artists
-- are only matched to pages that already exist; new pages wait.
create or replace function sc_existing_work_left()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select (select count(*) from tracks t
          where t.artist_id in (select artist_id from follows)
            and (t.spotify_url is null and t.spotify_search_attempted_at is null
                 or t.genius_checked_at is null and (t.producers is null or t.featured_artists is null))) > 200;
$$;
revoke execute on function sc_existing_work_left() from public, anon, authenticated;

create or replace function sc_guest_next(p_secret text, p_limit integer default 8)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_wait boolean := sc_existing_work_left();
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then
    raise exception 'not authorized';
  end if;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform sc_guest_refresh();
  return jsonb_build_object(
    'known', (select coalesce(jsonb_object_agg(spotify_artist_id, id), '{}'::jsonb) from artists where spotify_artist_id is not null),
    'new_pages', not v_wait,
    'guests', (
      with hosts as (
        -- How much the artists they feature with matter (the shared order).
        select lower(sc_guest_name(t.notes)) k, max(w.weight) wt
        from tracks t join sc_artist_weights() w on w.artist_id = t.artist_id
        where t.notes like 'Feature on %'
        group by 1
      ), picked as (
        select g.* from guest_artists g left join hosts h on h.k = g.name_key
        where g.state = 'pending' and g.songs > 0
          -- Waiting for new pages: each guest is looked at once a week (in
          -- case they turn out to be an artist already here).
          and (not v_wait or g.checked_at is null or g.checked_at < now() - interval '7 days')
        order by coalesce(h.wt, 0) desc, g.songs desc, g.name
        limit greatest(1, least(coalesce(p_limit, 8), 20))
      ), titles as (
        select lower(sc_guest_name(t.notes)) k, t.title, row_number() over (partition by lower(sc_guest_name(t.notes)) order by t.id) rn
        from tracks t
        where t.notes like 'Feature on %' and lower(sc_guest_name(t.notes)) in (select name_key from picked)
      )
      select coalesce(jsonb_agg(jsonb_build_object('key', p.name_key, 'name', p.name,
               'titles', (select jsonb_agg(ti.title) from titles ti where ti.k = p.name_key and ti.rn <= 3))), '[]'::jsonb)
      from picked p));
end;
$$;

-- A guest who'd need a new page while existing artists are still being
-- filled in: noted (with the Spotify profile found) and left for later.
create or replace function sc_guest_wait(p_secret text, p_key text, p_spotify_id text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then
    raise exception 'not authorized';
  end if;
  update guest_artists set checked_at = now(), spotify_artist_id = coalesce(p_spotify_id, spotify_artist_id),
         note = 'Waiting: existing artists are being filled in first.'
  where name_key = p_key and state = 'pending';
end;
$$;
revoke execute on function sc_guest_wait(text, text, text) from public, anon, authenticated;

-- Guest artist editing: fix the name, or link to a different page.
create or replace function admin_guest_edit(p_key text, p_name text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not is_moderator() then raise exception 'not authorized'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Type a name.'; end if;
  update guest_artists set name = trim(p_name) where name_key = p_key;
end;
$$;
revoke execute on function admin_guest_edit(text, text) from public, anon;
grant execute on function admin_guest_edit(text, text) to authenticated;

-- ----------------------------------------------------------------- 4

-- YouTube search for songs with no listen link. YouTube allows about 100
-- searches a day for free, so this is slow on purpose (its own allowance,
-- "ytsearch":
-- 1 a minute, 90 a day). Results go to possible links for review, never
-- straight onto the song.
insert into sc_private_settings (key, value) values ('ytsearch_per_minute', '1'), ('ytsearch_per_day', '90')
on conflict (key) do nothing;

create table if not exists youtube_searches (
  track_id text primary key references tracks (id) on delete cascade,
  searched_at timestamptz not null default now(),
  found int not null default 0
);
alter table youtube_searches enable row level security;
revoke all on youtube_searches from anon, authenticated;

-- Next songs to look for: main songs with no link, no possible links
-- waiting and not searched in the last 90 days; artists in the shared order.
create or replace function sc_youtube_next(p_secret text, p_limit int default 1)
returns table (track_id text, title text, artist text, release_status text)
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then
    raise exception 'not authorized';
  end if;
  return query
  with w as (select * from sc_artist_weights() where weight > 0)
  select t.id, t.title, a.name, t.release_status
  from tracks t join artists a on a.id = t.artist_id join w on w.artist_id = t.artist_id
  where t.spotify_url is null and t.parent_track_id is null and not t.has_file
    and not exists (select 1 from track_link_candidates c where c.track_id = t.id)
    and not exists (select 1 from youtube_searches y where y.track_id = t.id and y.searched_at > now() - interval '90 days')
  order by w.weight desc, (t.release_status in ('released', 'leaked', 'snippet')) desc, t.id
  limit greatest(1, least(coalesce(p_limit, 1), 5));
end;
$$;
revoke execute on function sc_youtube_next(text, int) from public, anon, authenticated;

create or replace function sc_youtube_save(p_secret text, p_track_id text, p_items jsonb)
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
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    if not exists (select 1 from track_link_candidates where track_id = p_track_id and url = it ->> 'url') then
      insert into track_link_candidates (track_id, artist_id, url, title, source_domain, source, link_kind, confidence, notes)
      select t.id, t.artist_id, it ->> 'url', it ->> 'title', 'youtube.com', 'youtube',
             case when (it ->> 'official')::boolean then 'official' else 'upload' end,
             (it ->> 'confidence')::numeric, it ->> 'notes'
      from tracks t where t.id = p_track_id;
      n := n + 1;
    end if;
  end loop;
  insert into youtube_searches (track_id, found) values (p_track_id, n)
  on conflict (track_id) do update set searched_at = now(), found = excluded.found;
  return n;
end;
$$;
revoke execute on function sc_youtube_save(text, text, jsonb) from public, anon, authenticated;

select cron.schedule('youtube-search', '*/15 * * * *', $$
  select net.http_post(
    url := 'https://pcuyzaamcsegblrauxsa.supabase.co/functions/v1/youtube-search',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select value from public.sc_private_settings where key = 'cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000);
$$);

-- YouTube search on the health page's outside services list.
create or replace function admin_api_budget()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select case when is_admin() then (
    select jsonb_object_agg(s, jsonb_build_object(
      'today', (select coalesce(sum(calls), 0) from api_budget where service = s and minute > now() - interval '24 hours'),
      'last_hour', (select coalesce(sum(calls), 0) from api_budget where service = s and minute > now() - interval '1 hour'),
      'per_day', (select value::int from sc_private_settings where key = s || '_per_day'),
      'per_minute', (select value::int from sc_private_settings where key = s || '_per_minute'),
      'paused_until', (select value from sc_private_settings where key = s || '_pause_until' and value::timestamptz > now())))
    from unnest(array['spotify', 'genius', 'lastfm', 'youtube', 'soundcloud', 'ytsearch']) s) end;
$$;

-- ----------------------------------------------------------------- 5c

-- ChatGPT routines: batches of up to 100 (was 50).
do $$
declare
  d text;
begin
  d := pg_get_functiondef('rpc_songs_needing_links(text,integer)'::regprocedure);
  execute replace(d, 'least(coalesce(p_limit, 25), 50)', 'least(coalesce(p_limit, 25), 100)');
  d := pg_get_functiondef('rpc_check_candidates(jsonb)'::regprocedure);
  execute replace(replace(d, 'n > 50', 'n > 100'), 'first 50 titles', 'first 100 titles');
  d := pg_get_functiondef('rpc_research_plan(integer)'::regprocedure);
  execute replace(d, '(up to 50 titles in one call)', '(up to 100 titles in one call)');
end $$;

-- ChatGPT routines can fill gaps in a song's details (album, release date,
-- producers, features, track number). Only empty fields; it goes to the
-- review list as a suggested edit, like any other.
create or replace function rpc_suggest_details(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  t tracks%rowtype;
  v jsonb := '{}'::jsonb;
  v_date date;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into t from tracks where id = p ->> 'track_id';
  if t.id is null then raise exception 'unknown track_id'; end if;
  if t.album is null and nullif(trim(p ->> 'album'), '') is not null then v := v || jsonb_build_object('album', left(trim(p ->> 'album'), 200)); end if;
  if t.producers is null and nullif(trim(p ->> 'producers'), '') is not null then v := v || jsonb_build_object('producers', left(trim(p ->> 'producers'), 300)); end if;
  if t.featured_artists is null and nullif(trim(p ->> 'featured_artists'), '') is not null then v := v || jsonb_build_object('featured_artists', left(trim(p ->> 'featured_artists'), 300)); end if;
  if t.track_number is null and (p ->> 'track_number') ~ '^\d{1,3}$' then v := v || jsonb_build_object('track_number', p ->> 'track_number'); end if;
  if t.release_date is null and (p ->> 'release_date') ~ '^\d{4}-\d{2}-\d{2}$' then
    begin
      v_date := (p ->> 'release_date')::date;
      if extract(year from v_date) between 1900 and 2100 then v := v || jsonb_build_object('release_date', v_date::text); end if;
    exception when others then null;
    end;
  end if;
  if v = '{}'::jsonb then
    return jsonb_build_object('ok', true, 'sent', false, 'note', 'Nothing new: those details are already filled in.');
  end if;
  if exists (select 1 from submissions where type = 'correction' and status = 'pending' and payload ->> 'track_id' = t.id
             and payload ->> 'from' = 'routine') then
    return jsonb_build_object('ok', true, 'sent', false, 'note', 'A suggestion for this song is already waiting for review.');
  end if;
  insert into submissions (type, artist_id, payload, submitted_by)
  values ('correction', t.artist_id,
          v || jsonb_build_object('track_id', t.id, 'from', 'routine',
                                  'source_url', nullif(p ->> 'source_url', ''), 'reviewer_note', left(coalesce(p ->> 'notes', ''), 1000)),
          auth.uid());
  return jsonb_build_object('ok', true, 'sent', true, 'fields', (select jsonb_agg(k) from jsonb_object_keys(v) k));
end;
$$;
revoke execute on function rpc_suggest_details(jsonb) from public, anon;
grant execute on function rpc_suggest_details(jsonb) to authenticated;

-- Moderators: use a possible link as the song's listen link (after playing
-- it). Fills an empty album / date / status from the suggestion too.
create or replace function admin_use_link_candidate(p_candidate uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  c track_link_candidates%rowtype;
begin
  if not is_moderator() then raise exception 'not authorized'; end if;
  select * into c from track_link_candidates where id = p_candidate;
  if c.id is null then raise exception 'That suggestion is gone.'; end if;
  perform set_config('static_cuts.batch_id', '', true);
  perform sc_begin_batch('links', 'Possible link used');
  update tracks set
    spotify_url = c.url,
    album = coalesce(album, c.album),
    release_date = coalesce(release_date, c.release_date),
    release_status = case when coalesce(release_status, 'unconfirmed') = 'unconfirmed' and c.suggested_status is not null
                          then c.suggested_status else release_status end
  where id = c.track_id;
  delete from track_link_candidates where id = c.id;
end;
$$;
revoke execute on function admin_use_link_candidate(uuid) from public, anon;
grant execute on function admin_use_link_candidate(uuid) to authenticated;
