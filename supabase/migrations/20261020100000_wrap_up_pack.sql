-- Wrap-up pack (run after 20261020090000_spotify_budget.sql):
--  1. Shared allowances for Genius, Last.fm, YouTube and SoundCloud, like
--     Spotify's, so jobs running at the same time can't add up past a limit.
--  2. Suggestion caps: limits on how many suggestions and links one account
--     can send an hour (comments already have this).
--  3. Stuck-job alert: the hourly background check now also tells you when
--     a timer has stopped running, not just when it fails.
--  4. Tidy-ups: undo history older than 6 months and old timer logs.
--  5. Dead link checker: a slow timer checks YouTube and SoundCloud links and
--     removes possible links that have been taken down.
--  6. Typo-friendly song search, and artist names count in search.
--  7. "Paste a tracklist" for the admin.

-- ----------------------------------------------------------------- 1

insert into sc_private_settings (key, value) values
  ('genius_per_minute', '30'), ('genius_per_day', '5000'),
  ('lastfm_per_minute', '60'), ('lastfm_per_day', '10000'),
  ('youtube_per_minute', '20'), ('youtube_per_day', '2000'),
  ('soundcloud_per_minute', '20'), ('soundcloud_per_day', '2000')
on conflict (key) do nothing;

-- Ask for up to p_want calls to a service; returns how many may be made
-- right now (0 while that service has asked us to pause). Limits live in
-- sc_private_settings as <service>_per_minute and <service>_per_day.
create or replace function sc_api_allow(p_service text, p_want int)
returns int
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  per_min int := coalesce((select value::int from sc_private_settings where key = p_service || '_per_minute'), 20);
  per_day int := coalesce((select value::int from sc_private_settings where key = p_service || '_per_day'), 2000);
  pause_until text := (select value from sc_private_settings where key = p_service || '_pause_until');
  this_min timestamptz := date_trunc('minute', now());
  used_min int;
  used_day int;
  give int;
begin
  if p_service is null or p_service !~ '^[a-z]+$' then raise exception 'unknown service'; end if;
  if p_want is null or p_want < 1 then return 0; end if;
  if pause_until is not null and pause_until::timestamptz > now() then return 0; end if;
  -- One caller at a time per service, so two jobs can't both take the last tickets.
  perform pg_advisory_xact_lock(hashtext(p_service || '_budget'));
  select coalesce(sum(calls), 0) into used_min from api_budget where service = p_service and minute = this_min;
  select coalesce(sum(calls), 0) into used_day from api_budget where service = p_service and minute > now() - interval '24 hours';
  give := greatest(0, least(p_want, per_min - used_min, per_day - used_day));
  if give > 0 then
    insert into api_budget (service, minute, calls) values (p_service, this_min, give)
    on conflict (service, minute) do update set calls = api_budget.calls + excluded.calls;
  end if;
  return give;
end;
$$;
revoke execute on function sc_api_allow(text, int) from public, anon, authenticated;
grant execute on function sc_api_allow(text, int) to service_role;

-- Spotify's own function now just uses the shared one (same limits as before).
create or replace function sc_spotify_allow(p_want int)
returns int
language sql
security definer
set search_path to 'public'
as $$ select sc_api_allow('spotify', p_want); $$;
revoke execute on function sc_spotify_allow(int) from public, anon, authenticated;
grant execute on function sc_spotify_allow(int) to service_role;

-- For the health page: every service's use today.
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
    from unnest(array['spotify', 'genius', 'lastfm', 'youtube', 'soundcloud']) s) end;
$$;
revoke execute on function admin_api_budget() from public, anon;
grant execute on function admin_api_budget() to authenticated;

-- ----------------------------------------------------------------- 2

create index if not exists submissions_by_time_idx on submissions (submitted_by, created_at desc);
create index if not exists link_candidates_by_time_idx on track_link_candidates (suggested_by, found_at desc);

create or replace function submissions_anti_spam()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_age interval;
  v_recent int;
begin
  -- Timers, imports and moderators aren't limited.
  if v_uid is null or is_moderator() then return new; end if;
  select now() - created_at into v_age from auth.users where id = v_uid;
  select count(*) into v_recent from submissions where submitted_by = v_uid and created_at > now() - interval '1 hour';
  if v_age < interval '1 day' and v_recent >= 10 then
    raise exception 'New accounts can send 10 suggestions an hour. Try again a bit later.';
  elsif v_recent >= 60 then
    raise exception 'That''s 60 suggestions in the last hour. Take a breather and try again soon.';
  end if;
  if exists (select 1 from submissions where submitted_by = v_uid and type = new.type and payload = new.payload
             and created_at > now() - interval '1 day') then
    raise exception 'You''ve already sent that suggestion.';
  end if;
  return new;
end;
$$;
drop trigger if exists submissions_anti_spam on submissions;
create trigger submissions_anti_spam before insert on submissions
  for each row execute function submissions_anti_spam();

create or replace function link_candidates_anti_spam()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_age interval;
  v_recent int;
begin
  if v_uid is null or is_moderator() then return new; end if;
  select now() - created_at into v_age from auth.users where id = v_uid;
  select count(*) into v_recent from track_link_candidates where suggested_by = v_uid and found_at > now() - interval '1 hour';
  if v_age < interval '1 day' and v_recent >= 10 then
    raise exception 'New accounts can suggest 10 links an hour. Try again a bit later.';
  elsif v_recent >= 60 then
    raise exception 'That''s 60 links in the last hour. Take a breather and try again soon.';
  end if;
  return new;
end;
$$;
drop trigger if exists link_candidates_anti_spam on track_link_candidates;
create trigger link_candidates_anti_spam before insert on track_link_candidates
  for each row execute function link_candidates_anti_spam();

-- ----------------------------------------------------------------- 3

create or replace function sc_background_check()
returns integer
language plpgsql
security definer
set search_path to 'public', 'net'
as $$
declare
  v_failed int;
  v_err text;
  v_stuck text;
  v_cron_failed text;
begin
  -- Calls to the background jobs that failed.
  select count(*), left(max(coalesce(error_msg, content::text, '')), 200) into v_failed, v_err
  from net._http_response
  where created > now() - interval '1 hour' and (timed_out or status_code >= 400 or error_msg is not null);
  if v_failed > 0 then
    insert into notifications (user_id, kind, title, body, link, dedupe_key)
    select a, 'admin', v_failed || ' background job call' || case when v_failed = 1 then '' else 's' end || ' failed in the last hour',
           v_err, '/admin/health', 'bg:' || to_char(now(), 'YYYY-MM-DD HH24')
    from sc_admin_ids(false) a
    on conflict do nothing;
  end if;

  -- Timers that have stopped running: hourly-or-faster ones after 3 hours,
  -- daily ones after 26 hours, monthly ones after 32 days.
  select string_agg(j.jobname, ', ' order by j.jobname) into v_stuck
  from cron.job j
  join lateral (select max(d.start_time) last_run from cron.job_run_details d where d.jobid = j.jobid) r on true
  where j.active and r.last_run is not null
    and r.last_run < now() - case
      when split_part(j.schedule, ' ', 3) <> '*' then interval '32 days'
      when split_part(j.schedule, ' ', 2) = '*' or split_part(j.schedule, ' ', 2) like '%/%' then interval '3 hours'
      else interval '26 hours' end;
  if v_stuck is not null then
    insert into notifications (user_id, kind, title, body, link, dedupe_key)
    select a, 'admin', 'A timer has stopped running',
           'Not run for longer than usual: ' || v_stuck || '. Check the health page.',
           '/admin/health', 'stuck:' || to_char(now(), 'YYYY-MM-DD') || ':' || v_stuck
    from sc_admin_ids(false) a
    on conflict do nothing;
  end if;

  -- Timers whose own database step failed.
  select string_agg(distinct j.jobname, ', ') into v_cron_failed
  from cron.job_run_details d join cron.job j on j.jobid = d.jobid
  where d.start_time > now() - interval '1 hour' and d.status = 'failed';
  if v_cron_failed is not null then
    insert into notifications (user_id, kind, title, body, link, dedupe_key)
    select a, 'admin', 'A timer failed in the last hour', 'Failed: ' || v_cron_failed || '.',
           '/admin/health', 'cronfail:' || to_char(now(), 'YYYY-MM-DD HH24')
    from sc_admin_ids(false) a
    on conflict do nothing;
  end if;

  return v_failed;
end;
$$;

-- ----------------------------------------------------------------- 4

-- Old counts, undo history older than 6 months (its changes stay, they just
-- can't be undone any more) and old timer logs. Daily at 04:15.
create or replace function sc_api_budget_tidy()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  delete from api_budget where minute < now() - interval '3 days';
  delete from change_batches where created_at < now() - interval '6 months';
  delete from cron.job_run_details where start_time < now() - interval '14 days';
end;
$$;
revoke execute on function sc_api_budget_tidy() from public, anon, authenticated;

-- ----------------------------------------------------------------- 5

create table if not exists link_checks (
  url text primary key,
  checked_at timestamptz,
  status int,
  dead_count int not null default 0,
  dead_confirmed_at timestamptz
);
alter table link_checks enable row level security;
revoke all on link_checks from anon, authenticated;

-- YouTube and SoundCloud links (possible links, and main links on songs)
-- due a check: never checked, last checked over 30 days ago, or found
-- missing once and due a second look a day later.
create or replace function sc_link_check_next(p_secret text, p_limit int default 15)
returns table (url text)
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then
    raise exception 'not authorized';
  end if;
  return query
  with links as (
    select c.url from track_link_candidates c
    union
    select t.spotify_url from tracks t where t.spotify_url is not null
  )
  select l.url
  from links l left join link_checks k on k.url = l.url
  -- YouTube videos only (not channels or playlists), any SoundCloud page.
  where l.url ~* '^https?://(([a-z]+\.)?youtube\.com/(watch\?.*v=|shorts/)|youtu\.be/|([a-z]+\.)?soundcloud\.com/)'
    and k.dead_confirmed_at is null
    and (k.checked_at is null
         or k.checked_at < now() - interval '30 days'
         or (k.dead_count = 1 and k.checked_at < now() - interval '1 day'))
  order by k.checked_at nulls first
  limit greatest(1, least(coalesce(p_limit, 15), 40));
end;
$$;
revoke execute on function sc_link_check_next(text, int) from public, anon, authenticated;
grant execute on function sc_link_check_next(text, int) to service_role;

-- Save results ([{url, status}]). A link is only treated as gone after two
-- "not found" answers a day apart; then possible links using it are
-- removed (they stay in the undo history) and the admin hears about any
-- song whose main link it was.
create or replace function sc_link_check_save(p_secret text, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  it jsonb;
  v_url text;
  v_status int;
  v_dead int;
  v_removed int := 0;
  v_confirmed int := 0;
  v_main int := 0;
  v_batch boolean := false;
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then
    raise exception 'not authorized';
  end if;
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_url := it ->> 'url';
    v_status := (it ->> 'status')::int;
    continue when v_url is null or v_status is null;
    insert into link_checks (url, checked_at, status, dead_count)
    values (v_url, now(), v_status, case when v_status = 404 then 1 else 0 end)
    on conflict (url) do update set checked_at = now(), status = excluded.status,
      dead_count = case when excluded.status = 404 then link_checks.dead_count + 1 else 0 end
    returning dead_count into v_dead;
    if v_dead >= 2 then
      update link_checks set dead_confirmed_at = now() where url = v_url;
      v_confirmed := v_confirmed + 1;
      if exists (select 1 from track_link_candidates where url = v_url) then
        if not v_batch then
          perform sc_begin_batch('link-check', 'Dead link check: removed possible links that were taken down');
          v_batch := true;
        end if;
        delete from track_link_candidates where url = v_url;
        get diagnostics v_dead = row_count;
        v_removed := v_removed + v_dead;
      end if;
      if exists (select 1 from tracks where spotify_url = v_url) then v_main := v_main + 1; end if;
    end if;
  end loop;
  if v_main > 0 then
    insert into notifications (user_id, kind, title, body, link, dedupe_key)
    select a, 'admin', v_main || ' song link' || case when v_main = 1 then ' has' else 's have' end || ' been taken down',
           'The listen link no longer works. They''re listed on the health page.',
           '/admin/health', 'deadlink:' || to_char(now(), 'YYYY-MM-DD')
    from sc_admin_ids(false) a
    on conflict do nothing;
  end if;
  return jsonb_build_object('checked', jsonb_array_length(coalesce(p_items, '[]'::jsonb)),
                            'confirmed_dead', v_confirmed, 'removed', v_removed, 'main_links', v_main);
end;
$$;
revoke execute on function sc_link_check_save(text, jsonb) from public, anon, authenticated;
grant execute on function sc_link_check_save(text, jsonb) to service_role;

-- For the health page: songs whose main link was taken down, and progress.
create or replace function admin_dead_links()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select case when is_admin() then jsonb_build_object(
    'checked', (select count(*) from link_checks),
    'dead', (select count(*) from link_checks where dead_confirmed_at is not null),
    'songs', (select coalesce(jsonb_agg(jsonb_build_object('track_id', t.id, 'title', t.title, 'artist_id', t.artist_id,
                                                            'artist', a.name, 'url', t.spotify_url) order by a.name, t.title), '[]'::jsonb)
              from tracks t join artists a on a.id = t.artist_id
              join link_checks k on k.url = t.spotify_url and k.dead_confirmed_at is not null)) end;
$$;
revoke execute on function admin_dead_links() from public, anon;
grant execute on function admin_dead_links() to authenticated;

select cron.unschedule('link-check') where exists (select 1 from cron.job where jobname = 'link-check');
select cron.schedule('link-check', '12-59/30 * * * *', $job$
  select net.http_post(
    url := 'https://pcuyzaamcsegblrauxsa.supabase.co/functions/v1/check-links',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select value from public.sc_private_settings where key = 'cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000);
$job$);

-- ----------------------------------------------------------------- 6

create extension if not exists pg_trgm with schema extensions;
create index if not exists tracks_title_trgm_idx on tracks using gin (lower(title) extensions.gin_trgm_ops);

-- Same as before, plus: the artist's name counts (so "carti magnolia"
-- works), and when nothing matches exactly it shows close matches instead
-- ("fuzzy": true), for typos like "magnolai".
create or replace function rpc_search_songs(p_q text default '', p_statuses text[] default null, p_year_from int default null,
  p_year_to int default null, p_has_link boolean default null, p_versions boolean default true, p_sort text default 'best',
  p_offset int default 0)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  with q as (
    select lower(trim(coalesce(p_q, ''))) q,
           array_remove(regexp_split_to_array(lower(trim(coalesce(p_q, ''))), '\s+'), '') w
  ),
  base as (
    select t.id, t.title, t.artist_id, a.name artist, t.spotify_url, t.album, t.release_date, t.created_at,
           t.parent_track_id, t.aliases, t.producers,
           coalesce(t.release_status, case when t.is_official then 'released' else 'unconfirmed' end) status,
           lower(t.title) ltitle
    from tracks t join artists a on a.id = t.artist_id
    where (p_statuses is null or coalesce(t.release_status, case when t.is_official then 'released' else 'unconfirmed' end) = any (p_statuses))
      and (p_year_from is null or extract(year from t.release_date) >= p_year_from)
      and (p_year_to is null or extract(year from t.release_date) <= p_year_to)
      and (p_has_link is null or (t.spotify_url is not null) = p_has_link)
      and (coalesce(p_versions, true) or t.parent_track_id is null)
  ),
  exact as (
    select b.*, 0::real sim from base b, q
    where cardinality(q.w) = 0 or not exists (
      select 1 from unnest(q.w) x
      where position(x in lower(b.title || ' ' || coalesce(b.aliases, '') || ' ' || coalesce(b.album, '')
                                || ' ' || coalesce(b.producers, '') || ' ' || b.artist)) = 0)
  ),
  fuzzy as (
    select b.*, extensions.word_similarity(q.q, b.ltitle) sim from base b, q
    where not exists (select 1 from exact) and length(q.q) >= 3
      and q.q operator(extensions.<%) b.ltitle
  ),
  hits as (select * from exact union all select * from fuzzy)
  select jsonb_build_object(
    'total', (select count(*) from hits),
    'fuzzy', not exists (select 1 from exact) and exists (select 1 from fuzzy),
    'items', (select coalesce(jsonb_agg(to_jsonb(x) - 'ltitle' - 'aliases' - 'producers' - 'sim'), '[]'::jsonb) from (
      select h.* from hits h, q
      order by
        h.sim desc,
        case when p_sort = 'best' then case when h.ltitle = q.q then 0
                                            when h.ltitle like q.q || '%' then 1
                                            when position(q.q in h.ltitle) > 0 then 2 else 3 end end,
        case when p_sort = 'new' then h.created_at end desc nulls last,
        case when p_sort = 'released' then h.release_date end desc nulls last,
        h.parent_track_id is not null, h.ltitle, h.artist
      offset greatest(coalesce(p_offset, 0), 0) limit 50) x));
$$;
grant execute on function rpc_search_songs(text, text[], int, int, boolean, boolean, text, int) to anon, authenticated;

-- ----------------------------------------------------------------- 7

-- Paste a tracklist onto an artist page: [{title, featuring}] in order.
-- Songs already on the page are skipped. One undo-history batch.
create or replace function admin_paste_tracklist(p_artist_id text, p_items jsonb, p_album text default null,
  p_release_date date default null, p_status text default 'released')
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  it record;
  v_title text;
  v_name text;
  v_id text;
  v_added int := 0;
  v_skipped text[] := '{}';
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  if p_status not in ('unconfirmed', 'rumored', 'teased', 'snippet', 'leaked', 'announced', 'released') then
    raise exception 'unknown status';
  end if;
  select name into v_name from artists where id = p_artist_id;
  if v_name is null then raise exception 'Unknown artist.'; end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) > 300 then raise exception 'Up to 300 songs at a time.'; end if;

  perform sc_begin_batch('paste', 'Pasted tracklist for ' || v_name || coalesce(' (' || nullif(trim(p_album), '') || ')', ''));
  perform set_config('static_cuts.skip_status_log', 'on', true);
  perform set_config('static_cuts.credit_user', '', true);

  create temp table if not exists _sc_paste_known (k text) on commit drop;
  truncate _sc_paste_known;
  insert into _sc_paste_known select k from sc_known_keys(p_artist_id);

  for it in select e.value v, e.ordinality n from jsonb_array_elements(p_items) with ordinality e loop
    v_title := trim(it.v ->> 'title');
    continue when v_title is null or v_title = '';
    if exists (select 1 from _sc_paste_known where k in (sc_title_key(v_title), sc_song_key(v_title))) then
      v_skipped := v_skipped || v_title;
      continue;
    end if;
    v_id := p_artist_id || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
    insert into tracks (id, artist_id, title, release_status, is_official, album, release_date, track_number, featured_artists, source)
    values (v_id, p_artist_id, v_title, p_status, p_status = 'released', nullif(trim(p_album), ''), p_release_date,
            case when nullif(trim(p_album), '') is not null then it.n::int end,
            nullif(trim(it.v ->> 'featuring'), ''), 'paste');
    insert into _sc_paste_known values (sc_title_key(v_title)), (sc_song_key(v_title));
    v_added := v_added + 1;
  end loop;
  return jsonb_build_object('added', v_added, 'skipped', to_jsonb(v_skipped));
end;
$$;
revoke execute on function admin_paste_tracklist(text, jsonb, text, date, text) from public, anon;
grant execute on function admin_paste_tracklist(text, jsonb, text, date, text) to authenticated;

select 'done' as result, (select count(*) from cron.job where jobname = 'link-check') as link_check_timer;
