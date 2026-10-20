-- Later pack (run after 20261022030000_control_room.sql):
--  1. Bands and duos: an artist page can be a group with members
--     (Y$ = Ye + Ty Dolla $ign). Members' pages show the group's songs.
--  2. Artist photo and about: picture from Spotify, short bio from Last.fm
--     (linked, with credit), filled in a few artists at a time; admins can
--     write their own about text instead.
--  3. Live progress for the Control room: what each job did in the last
--     hour and what it's on now.
--  4. Genius songs that are clear-cut are added without review (switch in
--     Control room -> Owner): the artist's own songs, no version words in the
--     title, nothing similar already on the page. Added as "unconfirmed"
--     (no status claim), all in the undo history.

-- ----------------------------------------------------------------- 1

create table if not exists artist_members (
  group_id text not null references artists (id) on delete cascade,
  member_id text not null references artists (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (group_id, member_id),
  check (group_id <> member_id)
);
alter table artist_members enable row level security;
drop policy if exists artist_members_read on artist_members;
create policy artist_members_read on artist_members for select using (true);
revoke insert, update, delete on artist_members from anon, authenticated;

-- An artist's groups and members, for the artist page.
create or replace function rpc_artist_groups(p_artist_id text)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select jsonb_build_object(
    'members', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name) order by a.name), '[]'::jsonb)
                from artist_members m join artists a on a.id = m.member_id where m.group_id = p_artist_id),
    'groups', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name,
                 'songs', (select count(*) from tracks t where t.artist_id = a.id and t.parent_track_id is null),
                 'recent', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'status', x.release_status)), '[]'::jsonb)
                            from (select t.id, t.title, t.release_status from tracks t
                                  where t.artist_id = a.id and t.parent_track_id is null
                                  order by t.release_date desc nulls last, t.created_at desc limit 12) x)) order by a.name), '[]'::jsonb)
               from artist_members m join artists a on a.id = m.group_id where m.member_id = p_artist_id));
$$;
grant execute on function rpc_artist_groups(text) to anon, authenticated;

create or replace function admin_set_group_member(p_group_id text, p_member_id text, p_on boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not is_moderator() then raise exception 'not authorized'; end if;
  if p_group_id = p_member_id then raise exception 'An artist can''t be a member of themselves.'; end if;
  if p_on then
    insert into artist_members (group_id, member_id) values (p_group_id, p_member_id) on conflict do nothing;
  else
    delete from artist_members where group_id = p_group_id and member_id = p_member_id;
  end if;
end;
$$;
revoke execute on function admin_set_group_member(text, text, boolean) from public, anon;
grant execute on function admin_set_group_member(text, text, boolean) to authenticated;

-- ----------------------------------------------------------------- 2

alter table artists add column if not exists image_url text;
alter table artists add column if not exists bio text;
alter table artists add column if not exists bio_source text;
alter table artists add column if not exists bio_source_url text;
alter table artists add column if not exists info_checked_at timestamptz;

-- Next artists to fill in: followed first (the shared order).
create or replace function sc_artist_info_next(p_secret text, p_limit int default 10)
returns table (artist_id text, name text, spotify_artist_id text, lastfm_name text, need_image boolean, need_bio boolean)
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then
    raise exception 'not authorized';
  end if;
  return query
  select a.id, a.name, a.spotify_artist_id, a.lastfm_name, a.image_url is null, a.bio is null
  from artists a left join sc_artist_weights() w on w.artist_id = a.id
  where (a.image_url is null or a.bio is null)
    and (a.info_checked_at is null or a.info_checked_at < now() - interval '30 days')
  order by coalesce(w.weight, 0) desc, (select count(*) from tracks t where t.artist_id = a.id) desc
  limit greatest(1, least(coalesce(p_limit, 10), 50));
end;
$$;
revoke execute on function sc_artist_info_next(text, int) from public, anon, authenticated;

create or replace function sc_artist_info_save(p_secret text, p_items jsonb)
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
    update artists set
      image_url = coalesce(image_url, nullif(it ->> 'image_url', '')),
      bio = coalesce(bio, nullif(it ->> 'bio', '')),
      bio_source = case when bio is null and nullif(it ->> 'bio', '') is not null then it ->> 'bio_source' else bio_source end,
      bio_source_url = case when bio is null and nullif(it ->> 'bio', '') is not null then it ->> 'bio_source_url' else bio_source_url end,
      info_checked_at = now()
    where id = it ->> 'artist_id';
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function sc_artist_info_save(text, jsonb) from public, anon, authenticated;

-- Admins: write the about text (or clear it) and change the photo link.
create or replace function admin_set_artist_about(p_artist_id text, p_bio text, p_image_url text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  update artists set
    bio = nullif(left(trim(coalesce(p_bio, '')), 3000), ''),
    bio_source = case when nullif(trim(coalesce(p_bio, '')), '') is null then null else 'Static Cuts' end,
    bio_source_url = null,
    image_url = case when p_image_url is null then image_url else nullif(trim(p_image_url), '') end,
    info_checked_at = now()
  where id = p_artist_id;
end;
$$;
revoke execute on function admin_set_artist_about(text, text, text) from public, anon;
grant execute on function admin_set_artist_about(text, text, text) to authenticated;

select cron.schedule('artist-info', '23,53 * * * *', $$
  select net.http_post(
    url := 'https://pcuyzaamcsegblrauxsa.supabase.co/functions/v1/artist-info',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select value from public.sc_private_settings where key = 'cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000);
$$);

-- ----------------------------------------------------------------- 3

-- Live progress: each job's last hour and what it's on now.
create or replace function admin_live()
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'cron'
as $$
  select case when is_admin() then jsonb_build_object(
    'at', now(),
    'spotify_match', jsonb_build_object(
      'last_hour', (select count(*) from tracks where spotify_search_attempted_at > now() - interval '1 hour'),
      'linked_last_hour', (select count(*) from tracks where spotify_search_attempted_at > now() - interval '1 hour' and spotify_url like '%open.spotify.com%'),
      'last', (select jsonb_build_object('title', t.title, 'artist', a.name, 'at', t.spotify_search_attempted_at, 'found', t.spotify_url is not null)
               from tracks t join artists a on a.id = t.artist_id where t.spotify_search_attempted_at is not null
               order by t.spotify_search_attempted_at desc limit 1)),
    'genius_credits', jsonb_build_object(
      'last_hour', (select count(*) from tracks where genius_checked_at > now() - interval '1 hour'),
      'last', (select jsonb_build_object('title', t.title, 'artist', a.name, 'at', t.genius_checked_at)
               from tracks t join artists a on a.id = t.artist_id where t.genius_checked_at is not null
               order by t.genius_checked_at desc limit 1)),
    'covers', jsonb_build_object(
      'last_hour', (select count(*) from tracks where cover_checked_at > now() - interval '1 hour')),
    'imports', (select coalesce(jsonb_agg(jsonb_build_object('source', r.source, 'artist', a.name, 'at', r.started_at,
                  'running', r.finished_at is null, 'error', r.error, 'suggested', r.suggested) order by r.started_at desc), '[]'::jsonb)
                from (select * from import_runs where started_at > now() - interval '3 hours' order by started_at desc limit 8) r
                left join artists a on a.id = r.artist_id),
    'youtube', jsonb_build_object(
      'last_hour', (select count(*) from youtube_searches where searched_at > now() - interval '1 hour'),
      'found_today', (select coalesce(sum(found), 0) from youtube_searches where searched_at > now() - interval '24 hours'),
      'last', (select jsonb_build_object('title', t.title, 'artist', a.name, 'at', y.searched_at, 'found', y.found)
               from youtube_searches y join tracks t on t.id = y.track_id join artists a on a.id = t.artist_id
               order by y.searched_at desc limit 1)),
    'guests', jsonb_build_object(
      'last_hour', (select count(*) from guest_artists where checked_at > now() - interval '1 hour'),
      'last', (select jsonb_build_object('name', g.name, 'state', g.state, 'at', g.checked_at)
               from guest_artists g where g.checked_at is not null order by g.checked_at desc limit 1)),
    'trackers', (select jsonb_build_object('title', s.title, 'at', s.last_synced_at, 'error', s.last_result ->> 'error')
                 from sheet_sources s where s.last_synced_at is not null order by s.last_synced_at desc limit 1),
    'running_now', (select coalesce(jsonb_agg(j.jobname), '[]'::jsonb)
                    from cron.job_run_details d join cron.job j on j.jobid = d.jobid
                    where d.status = 'running' and d.start_time > now() - interval '15 minutes'),
    'artist_info', jsonb_build_object(
      'with_photo', (select count(*) from artists where image_url is not null),
      'with_about', (select count(*) from artists where bio is not null),
      'artists', (select count(*) from artists))
  ) end;
$$;
revoke execute on function admin_live() from public, anon;
grant execute on function admin_live() to authenticated;

-- ----------------------------------------------------------------- 4

insert into sc_private_settings (key, value) values ('genius_auto_add', 'on') on conflict (key) do nothing;

-- Clear-cut Genius songs: added straight to the page as "unconfirmed".
-- Anything with version words (demo, remix, v2, snippet, live...), a feature
-- on someone else's song, or a title close to one already on the page still
-- goes to the review list.
create or replace function sc_auto_add_genius()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_ids uuid[];
  n int;
begin
  if coalesce((select value from sc_private_settings where key = 'genius_auto_add'), 'off') <> 'on' then return 0; end if;
  select array_agg(s.id) into v_ids from (
    select s.id from import_suggestions s
    where s.state = 'open' and s.source = 'genius' and s.main_artist_name is null
      and s.created_at < now() - interval '30 minutes'
      and s.title !~* '(\m(demo|remix|rmx|mix|version|v\d+|live|snippet|acoustic|instrumental|edit|sped|slowed|reverb|skit|interlude|intro|outro|freestyle|leak|og|alt|alternate|cdq|session|reference|ref|unreleased|bootleg|mashup|cover|tracklist)\M|[\[\(\*\?])'
      and length(s.title) between 2 and 80
      and not exists (select 1 from track_title_keys tk where tk.artist_id = s.artist_id
                      and extensions.similarity(tk.key, sc_title_key(s.title)) > 0.6)
    order by s.created_at
    limit 300) s;
  if v_ids is null then return 0; end if;
  perform set_config('static_cuts.trusted_apply', 'on', true);
  perform set_config('static_cuts.batch_id', '', true);
  n := admin_apply_import_suggestions(v_ids, 'unconfirmed');
  perform set_config('static_cuts.trusted_apply', '', true);
  -- Relabel the batch so the undo history says where it came from.
  update change_batches set label = 'Genius: ' || n || ' clear-cut song' || case when n = 1 then '' else 's' end || ' added automatically'
  where id = nullif(current_setting('static_cuts.batch_id', true), '')::uuid;
  return n;
end;
$$;
revoke execute on function sc_auto_add_genius() from public, anon, authenticated;

select cron.schedule('genius-auto-add', '45 * * * *', $$ select public.sc_auto_add_genius(); $$);

-- Owner switch.
create or replace function owner_set_genius_auto(p_on boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not is_owner() then raise exception 'Only the owner can change this.'; end if;
  insert into sc_private_settings (key, value) values ('genius_auto_add', case when p_on then 'on' else 'off' end)
  on conflict (key) do update set value = excluded.value;
end;
$$;
revoke execute on function owner_set_genius_auto(boolean) from public, anon;
grant execute on function owner_set_genius_auto(boolean) to authenticated;

create or replace function owner_genius_auto()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select case when is_owner() then jsonb_build_object(
    'on', coalesce((select value from sc_private_settings where key = 'genius_auto_add'), 'off') = 'on',
    'added_7d', (select coalesce(sum((regexp_match(label, '^Genius: (\d+)'))[1]::int), 0) from change_batches
                 where label like 'Genius: % added automatically' and created_at > now() - interval '7 days'),
    'waiting', (select count(*) from import_suggestions where state = 'open' and source = 'genius')) end;
$$;
revoke execute on function owner_genius_auto() from public, anon;
grant execute on function owner_genius_auto() to authenticated;
