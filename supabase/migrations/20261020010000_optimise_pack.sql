-- Optimisation pack.
--
-- 1. Spotify timers send the timer password (the Spotify functions now turn
--    away anyone else except the admin's link tools page).
-- 2. rpc_home_artists: the home page's artist list in one call, instead of
--    downloading every song to count them.
-- 3. Suggestions are only readable in full by their author and moderators.
--    Artist changelogs get the safe parts from rpc_artist_changelog.
-- 4. admin_job_progress: how far the background jobs have got, for the
--    health page.
-- 5. Artist nicknames (Ye = Kanye West): used when matching imports and
--    guest artists, in home page search, and shown on artist pages.
-- 6. rpc_sitemap: every artist and song for search engines.

-- 1. Timers ---------------------------------------------------------------
select cron.unschedule(jobname) from cron.job where jobname in ('spotify-match', 'spotify-verify');

select cron.schedule('spotify-match', '1-59/5 * * * *', $job$
  select net.http_post(
    url := 'https://pcuyzaamcsegblrauxsa.supabase.co/functions/v1/match-spotify?limit=10',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select value from public.sc_private_settings where key = 'cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000);
$job$);

select cron.schedule('spotify-verify', '24 * * * *', $job$
  select net.http_post(
    url := 'https://pcuyzaamcsegblrauxsa.supabase.co/functions/v1/verify-spotify-links?limit=10',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select value from public.sc_private_settings where key = 'cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000);
$job$);

-- 5a. Nicknames (before the functions that use them) ----------------------
create table if not exists artist_aliases (
  alias_key text primary key,
  alias text not null,
  artist_id text not null references artists (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists artist_aliases_artist on artist_aliases (artist_id);
alter table artist_aliases enable row level security;
drop policy if exists artist_aliases_read on artist_aliases;
create policy artist_aliases_read on artist_aliases for select using (true);
revoke insert, update, delete on artist_aliases from anon, authenticated;

-- Imports, sheets and guests find artists by name or nickname.
create or replace function sc_find_artist(p_name text)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select id from (
    select id, 0 pri from artists
    where sc_normalize_title(p_name) <> '' and sc_normalize_title(name) = sc_normalize_title(p_name)
    union all
    select artist_id, 1 from artist_aliases
    where sc_normalize_title(p_name) <> '' and alias_key = sc_normalize_title(p_name)
  ) x
  order by pri, id
  limit 1
$$;

-- Admin: replace an artist's nicknames.
create or replace function admin_set_artist_aliases(p_artist text, p_aliases text[])
returns text[]
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  a text;
  k text;
  taken text;
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  if not exists (select 1 from artists where id = p_artist) then raise exception 'unknown artist'; end if;
  foreach a in array coalesce(p_aliases, '{}') loop
    k := sc_normalize_title(a);
    if k = '' then continue; end if;
    select id into taken from artists where sc_normalize_title(name) = k and id <> p_artist limit 1;
    if taken is not null then raise exception '"%" is already the name of another artist', trim(a); end if;
    select artist_id into taken from artist_aliases where alias_key = k and artist_id <> p_artist;
    if taken is not null then raise exception '"%" is already a nickname of another artist', trim(a); end if;
  end loop;
  delete from artist_aliases where artist_id = p_artist;
  insert into artist_aliases (alias_key, alias, artist_id)
  select distinct on (sc_normalize_title(x)) sc_normalize_title(x), trim(x), p_artist
  from unnest(coalesce(p_aliases, '{}')) x
  where sc_normalize_title(x) <> ''
    and sc_normalize_title(x) <> (select sc_normalize_title(name) from artists where id = p_artist);
  return array(select alias from artist_aliases where artist_id = p_artist order by alias);
end;
$$;

-- Guests whose name is an artist here (or one of their nicknames) are linked
-- straight away, without asking Spotify.
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
  update guest_artists ga set songs = 0
  where ga.songs > 0 and not exists (select 1 from tracks where notes like 'Feature on %' and lower(sc_guest_name(notes)) = ga.name_key);
  update guest_artists ga set artist_id = sc_find_artist(ga.name), state = 'linked', checked_at = now(), note = null
  where ga.songs > 0 and ga.artist_id is null and ga.state in ('pending', 'review') and sc_find_artist(ga.name) is not null;
  for g in select * from guest_artists where artist_id is not null and songs > 0 loop
    perform set_config('static_cuts.batch_id', '', true);
    perform sc_begin_batch('guests', 'Songs moved to ' || g.name || '''s page');
    n := n + sc_guest_move(g.name_key, g.artist_id);
    update guest_artists set songs = 0 where name_key = g.name_key;
  end loop;
  return n;
end;
$$;

-- A few obvious ones to start with.
insert into artist_aliases (alias_key, alias, artist_id)
select sc_normalize_title(v.alias), v.alias, v.artist_id
from (values ('Ye', 'kanye-west'), ('Yeezy', 'kanye-west'), ('Uzi', 'lil-uzi-vert'), ('Lil Uzi', 'lil-uzi-vert'),
             ('Carti', 'playboi-carti'), ('Sosa', 'chief-keef'), ('XXX', 'xxxtentacion')) v(alias, artist_id)
where exists (select 1 from artists a where a.id = v.artist_id)
  and not exists (select 1 from artists a where sc_normalize_title(a.name) = sc_normalize_title(v.alias))
on conflict (alias_key) do nothing;

-- 2. Home page ------------------------------------------------------------
-- p_mine: include the signed-in person's collected counts (the home page
-- passes false in admin mode).
create or replace function rpc_home_artists(p_mine boolean default true)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  with counts as (
    select artist_id, count(*) n from tracks group by artist_id
  ), mine as (
    select t.artist_id, count(*) n
    from track_ownership o join tracks t on t.id = o.track_id
    where p_mine and auth.uid() is not null and o.user_id = auth.uid()
    group by t.artist_id
  ), nick as (
    select artist_id, array_agg(alias order by alias) aliases from artist_aliases group by artist_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'name', a.name, 'status', a.status,
    'track_count', coalesce(c.n, 0), 'collected', coalesce(m.n, 0),
    'avg_rating', r.avg_rating, 'rating_count', coalesce(r.rating_count, 0),
    'aliases', coalesce(k.aliases, '{}')
  ) order by a.name), '[]'::jsonb)
  from artists a
  left join counts c on c.artist_id = a.id
  left join mine m on m.artist_id = a.id
  left join artist_rating_stats r on r.artist_id = a.id
  left join nick k on k.artist_id = a.id;
$$;

-- 3. Suggestions ----------------------------------------------------------
drop policy if exists "Public can read all submissions for changelog" on submissions;
drop policy if exists submissions_read_own_or_mod on submissions;
create policy submissions_read_own_or_mod on submissions for select
  using (submitted_by = (select auth.uid()) or (select is_moderator()));

create or replace function rpc_artist_changelog(p_artist text, p_limit int default 50)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) from (
    select s.id, s.type, s.status, s.created_at, s.submitted_by,
           s.payload ->> 'title' as title,
           s.payload ->> 'from_status' as from_status,
           s.payload ->> 'to_status' as to_status
    from submissions s
    where s.artist_id = p_artist and s.status <> 'pending'
    order by s.created_at desc
    limit greatest(1, least(coalesce(p_limit, 50), 200))
  ) x;
$$;

-- 4. Job progress ---------------------------------------------------------
create or replace function admin_job_progress()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select case when is_admin() then jsonb_build_object(
    'spotify', (select jsonb_build_object(
        'left', count(*) filter (where spotify_url is null and spotify_search_attempted_at is null),
        'searched', count(*) filter (where spotify_search_attempted_at is not null),
        'linked', count(*) filter (where spotify_url is not null),
        'links_checked_30d', count(*) filter (where spotify_url is not null and spotify_link_verified_at > now() - interval '30 days'),
        'paused_until', (select value from sc_private_settings where key = 'spotify_pause_until')
      ) from tracks),
    'genius', (select jsonb_build_object(
        'checked', count(*) filter (where genius_checked_at is not null),
        'left', count(*) filter (where genius_checked_at is null and (producers is null or featured_artists is null or cover_url is null))
      ) from tracks),
    'covers', (select jsonb_build_object(
        'have', count(*) filter (where cover_url is not null),
        'left', count(*) filter (where cover_url is null and cover_checked_at is null
                                  and spotify_url ~ '^https://open\.spotify\.com/(track|album)/')
      ) from tracks),
    'guests', (select coalesce(jsonb_object_agg(state, n), '{}'::jsonb)
               from (select state, count(*) n from guest_artists where songs > 0 or state in ('created', 'linked') group by state) g)
  ) end;
$$;

-- 6. Sitemap --------------------------------------------------------------
create or replace function rpc_sitemap()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select jsonb_build_object(
    'artists', (select coalesce(jsonb_agg(id order by id), '[]'::jsonb) from artists),
    'songs', (select coalesce(jsonb_agg(id order by id), '[]'::jsonb) from tracks)
  );
$$;

revoke execute on function admin_set_artist_aliases(text, text[]), admin_job_progress() from public, anon;
grant execute on function admin_set_artist_aliases(text, text[]), admin_job_progress() to authenticated;
grant execute on function rpc_home_artists(boolean), rpc_artist_changelog(text, int), rpc_sitemap() to anon, authenticated;

-- Link anyone the new nicknames already cover (Ye -> Kanye West).
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select sc_guest_refresh() songs_moved,
       (select count(*) from artist_aliases) nicknames,
       (select jsonb_array_length(rpc_home_artists(false))) artists;
