-- Artist priority queue: one shared ranking that decides which artists get
-- checked next, by ChatGPT routines now and by the Spotify/Genius/Last.fm
-- imports later.
--
-- Up the queue:
--   empty or thin pages (0 songs, up to 10, up to 50)
--   requests ("check this artist" presses, one per person per day, last 30 days)
--   followers
--   something new found recently (check again soon)
-- Down the queue:
--   checked recently: each artist has a "next check" time
--   quiet artists: every check that finds nothing waits longer before the
--   next one (1 day, 3 days, 1 week, 2 weeks, then monthly). Finding
--   something resets it to daily.
--
-- Server jobs take artists from the queue with sc_claim_artists(), which
-- lets only a few artists through per hour for each source.

alter table artist_research_state add column if not exists quiet_streak int not null default 0;
alter table artist_research_state add column if not exists next_due_at timestamptz;
alter table artist_research_state add column if not exists last_found_at timestamptz;
alter table artist_research_state alter column last_researched_at drop not null;

create table if not exists artist_requests (
  artist_id text not null references artists(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  day date not null default current_date,
  created_at timestamptz not null default now(),
  primary key (artist_id, user_id, day)
);
create index if not exists artist_requests_artist_idx on artist_requests (artist_id, created_at);
alter table artist_requests enable row level security;
drop policy if exists artist_requests_admin_read on artist_requests;
create policy artist_requests_admin_read on artist_requests for select using (is_admin());
revoke all on artist_requests from anon;
revoke insert, update, delete on artist_requests from authenticated;

create table if not exists artist_queue_claims (
  id bigint generated always as identity primary key,
  source text not null,
  artist_id text not null references artists(id) on delete cascade,
  claimed_at timestamptz not null default now()
);
create index if not exists artist_queue_claims_source_idx on artist_queue_claims (source, claimed_at desc);
alter table artist_queue_claims enable row level security;
drop policy if exists artist_queue_claims_admin_read on artist_queue_claims;
create policy artist_queue_claims_admin_read on artist_queue_claims for select using (is_admin());
revoke all on artist_queue_claims from anon;
revoke insert, update, delete on artist_queue_claims from authenticated;

-- How long to wait after a check, by how many checks in a row found nothing.
create or replace function sc_quiet_wait(p_streak int)
returns interval
language sql
immutable
set search_path to 'public'
as $$
  select case
    when coalesce(p_streak, 0) <= 0 then interval '1 day'
    when p_streak = 1 then interval '3 days'
    when p_streak = 2 then interval '7 days'
    when p_streak = 3 then interval '14 days'
    else interval '30 days'
  end;
$$;

-- Record that an artist was checked (by a routine or an import) and whether
-- anything new turned up. Sets when it's next due.
create or replace function sc_record_check(p_artist_id text, p_found int, p_by uuid default auth.uid())
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_streak int;
begin
  insert into artist_research_state (artist_id, last_researched_at, last_researched_by, research_count)
  values (p_artist_id, now(), p_by, 0)
  on conflict (artist_id) do nothing;

  update artist_research_state set
    last_researched_at = now(),
    last_researched_by = coalesce(p_by, last_researched_by),
    research_count = research_count + 1,
    quiet_streak = case when coalesce(p_found, 0) > 0 then 0 else quiet_streak + 1 end,
    last_found_at = case when coalesce(p_found, 0) > 0 then now() else last_found_at end
  where artist_id = p_artist_id
  returning quiet_streak into v_streak;

  update artist_research_state set next_due_at = now() + sc_quiet_wait(v_streak)
  where artist_id = p_artist_id;
end;
$$;

-- The ranking. Higher score = check sooner. Only "due" artists are handed
-- out; the rest show when they're next due.
create or replace function sc_artist_queue(p_limit int default 50, p_only_due boolean default true)
returns table (
  artist_id text, name text, score numeric, due boolean, next_due_at timestamptz,
  track_count bigint, followers bigint, requests bigint, last_checked_at timestamptz,
  quiet_streak int, reasons text[]
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with base as (
    select a.id, a.name,
      (select count(*) from tracks t where t.artist_id = a.id) as n_tracks,
      (select count(*) from follows f where f.artist_id = a.id) as n_followers,
      (select count(*) from artist_requests r where r.artist_id = a.id and r.created_at > now() - interval '30 days') as n_requests,
      rs.last_researched_at, rs.next_due_at, coalesce(rs.quiet_streak, 0) as streak, rs.last_found_at
    from artists a
    left join artist_research_state rs on rs.artist_id = a.id
  ),
  scored as (
    select b.*,
      (case when b.n_tracks = 0 then 100 when b.n_tracks <= 10 then 60 when b.n_tracks <= 50 then 20 else 0 end
       + least(b.n_requests, 10) * 15
       + round(10 * ln(1 + b.n_followers)::numeric, 1)
       + case when b.last_found_at > now() - interval '14 days' then 30 else 0 end
       + case when b.last_researched_at is null then 40 else 0 end
       -- Overdue artists creep up the longer they wait.
       + least(greatest(extract(epoch from (now() - coalesce(b.next_due_at, now()))) / 86400.0, 0), 30)
      )::numeric as score,
      (b.next_due_at is null or b.next_due_at <= now()) as is_due
    from base b
  )
  select s.id, s.name, s.score, s.is_due, s.next_due_at, s.n_tracks, s.n_followers, s.n_requests,
    s.last_researched_at, s.streak,
    array_remove(array[
      case when s.n_tracks = 0 then 'empty page' when s.n_tracks <= 10 then 'only ' || s.n_tracks || ' songs' end,
      case when s.last_researched_at is null then 'never checked' end,
      case when s.n_requests > 0 then s.n_requests || ' request' || case when s.n_requests = 1 then '' else 's' end end,
      case when s.last_found_at > now() - interval '14 days' then 'new music found recently' end,
      case when s.n_followers > 0 then s.n_followers || ' follower' || case when s.n_followers = 1 then '' else 's' end end,
      case when s.streak >= 2 then 'quiet (' || s.streak || ' checks with nothing new)' end,
      case when not s.is_due then 'next check ' || to_char(s.next_due_at at time zone 'Europe/London', 'DD Mon HH24:MI') end
    ], null)
  from scored s
  where (not p_only_due or s.is_due)
  order by s.is_due desc, s.score desc, s.last_researched_at nulls first
  limit greatest(1, least(coalesce(p_limit, 50), 500));
$$;

-- For server jobs (imports): hand out the next due artists for one source,
-- at most p_per_hour per hour, never the same artist twice within a day.
create or replace function sc_claim_artists(p_source text, p_count int default 1, p_per_hour int default 6)
returns text[]
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_used int;
  v_ids text[];
  v_role text := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
begin
  if not (is_admin() or v_role = 'service_role' or session_user in ('postgres', 'supabase_admin')) then
    raise exception 'not authorized';
  end if;
  -- One claimer at a time per source.
  perform pg_advisory_xact_lock(hashtext('sc_claim_artists:' || p_source));
  select count(*) into v_used from artist_queue_claims
  where source = p_source and claimed_at > now() - interval '1 hour';
  if v_used >= p_per_hour then
    return '{}';
  end if;
  select array_agg(q.artist_id) into v_ids
  from (
    select q.artist_id from sc_artist_queue(200, true) q
    where not exists (select 1 from artist_queue_claims c
                      where c.source = p_source and c.artist_id = q.artist_id
                        and c.claimed_at > now() - interval '1 day')
    limit least(greatest(coalesce(p_count, 1), 1), p_per_hour - v_used)
  ) q;
  insert into artist_queue_claims (source, artist_id) select p_source, unnest(coalesce(v_ids, '{}'));
  delete from artist_queue_claims where claimed_at < now() - interval '7 days';
  return coalesce(v_ids, '{}');
end;
$$;

-- "Check this artist" button: one request per person per artist per day.
create or replace function rpc_request_artist_check(p_artist_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not exists (select 1 from artists where id = p_artist_id) then raise exception 'unknown artist'; end if;
  insert into artist_requests (artist_id, user_id) values (p_artist_id, auth.uid()) on conflict do nothing;
  -- A request makes the artist due straight away.
  update artist_research_state set next_due_at = least(coalesce(next_due_at, now()), now())
  where artist_id = p_artist_id;
  return jsonb_build_object('ok', true,
    'requests', (select count(*) from artist_requests where artist_id = p_artist_id and created_at > now() - interval '30 days'));
end;
$$;

-- finish_run now records per artist whether anything new turned up, which
-- drives the "quiet artists wait longer" rule.
create or replace function public.rpc_finish_run(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  uid uuid := auth.uid();
  v_ids text[];
  v_id text;
  v_found int;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;

  select coalesce(array_agg(x), '{}') into v_ids
  from jsonb_array_elements_text(coalesce(p -> 'artist_ids', '[]'::jsonb)) x
  where exists (select 1 from follows f where f.user_id = uid and f.artist_id = x);

  foreach v_id in array v_ids loop
    -- New finds this user filed for the artist in the last 12 hours.
    select count(*) into v_found
    from discovery_evidence e join discoveries d on d.id = e.discovery_id
    where e.user_id = uid and e.created_at > now() - interval '12 hours'
      and (d.artist_id = v_id or d.main_artist_id = v_id);
    perform sc_record_check(v_id, v_found, uid);
  end loop;

  insert into routine_runs (user_id, client_id, artists_checked, findings, submitted, summary)
  values (
    uid, auth.jwt() ->> 'client_id', coalesce(array_length(v_ids, 1), 0),
    nullif(p ->> 'findings', '')::int, nullif(p ->> 'submitted', '')::int,
    left(nullif(p ->> 'summary', ''), 4000)
  );

  return jsonb_build_object('ok', true, 'artists_marked', coalesce(array_length(v_ids, 1), 0));
end;
$$;

-- The research plan now hands out the user's followed artists in queue
-- order: due ones first, highest priority first.
create or replace function public.rpc_research_plan(p_limit integer default 15)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  uid uuid := auth.uid();
  result jsonb;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;

  select coalesce(jsonb_agg(x order by (x->>'_due')::boolean desc, (x->>'_score')::numeric desc), '[]'::jsonb) into result
  from (
    select jsonb_build_object(
      '_due', q.due,
      '_score', q.score,
      'artist_id', ar.id,
      'name', ar.name,
      'due', q.due,
      'why', to_jsonb(q.reasons),
      'last_researched_at', rs.last_researched_at,
      'researched_recently', not q.due,
      -- Two days of overlap so nothing slips between runs.
      'search_since', to_char((rs.last_researched_at - interval '2 days') at time zone 'UTC', 'YYYY-MM-DD'),
      'known_track_count', q.track_count,
      'watch_list', coalesce((
        select jsonb_agg(jsonb_build_object('track_id', t.id, 'title', t.title, 'status', t.release_status))
        from (
          select id, title, release_status from tracks t
          where t.artist_id = ar.id and t.release_status in ('rumored', 'teased', 'snippet', 'announced')
          order by title limit 100
        ) t
      ), '[]'::jsonb),
      'needs_status', coalesce((
        select jsonb_agg(jsonb_build_object('track_id', t.id, 'title', t.title))
        from (
          select id, title from tracks t
          where t.artist_id = ar.id and t.release_status = 'unconfirmed' and t.parent_track_id is null
          order by t.routine_checked_at nulls first, t.title
          limit 10
        ) t
      ), '[]'::jsonb),
      'recently_added', coalesce((
        select jsonb_agg(jsonb_build_object('title', t.title, 'status', t.release_status))
        from (
          select t.title, t.release_status from tracks t
          where (t.artist_id = ar.id
                 or exists (select 1 from track_appearances a where a.track_id = t.id and a.artist_id = ar.id))
            and (t.created_at > now() - interval '60 days'
                 or exists (select 1 from track_status_events e
                            where e.track_id = t.id and e.created_at > now() - interval '60 days'))
          order by coalesce(t.created_at, now()) desc
          limit 60
        ) t
      ), '[]'::jsonb),
      'already_handled', coalesce((
        select jsonb_agg(jsonb_build_object(
          'title', d.title, 'version', d.version_hint, 'status', d.to_status,
          'outcome', case when d.state = 'promoted' then 'added' else 'dismissed' end))
        from (
          select title, version_hint, to_status, state from discoveries d
          where (d.artist_id = ar.id or d.main_artist_id = ar.id)
            and d.state in ('promoted', 'dismissed', 'stale')
            and coalesce(d.reviewed_at, d.last_seen_at) > now() - interval '90 days'
          order by coalesce(d.reviewed_at, d.last_seen_at) desc limit 60
        ) d
      ), '[]'::jsonb),
      'open_discoveries', coalesce((
        select jsonb_agg(jsonb_build_object('title', d.title, 'version', d.version_hint,
                                            'to_status', d.to_status, 'type', d.development_type))
        from (
          select title, version_hint, to_status, development_type from discoveries d
          where (d.artist_id = ar.id or d.main_artist_id = ar.id) and d.state = 'open'
          order by last_seen_at desc limit 50
        ) d
      ), '[]'::jsonb)
    ) as x
    from follows f
    join artists ar on ar.id = f.artist_id
    join sc_artist_queue(500, false) q on q.artist_id = ar.id
    left join artist_research_state rs on rs.artist_id = ar.id
    where f.user_id = uid
    order by q.due desc, q.score desc
    limit greatest(1, least(coalesce(p_limit, 15), 50))
  ) s;

  return jsonb_build_object(
    'artists', (select coalesce(jsonb_agg(e - '_due' - '_score'), '[]'::jsonb) from jsonb_array_elements(result) e),
    'note', 'Shared across everyone using Static Cuts, so don''t redo work. Artists come in priority order. '
      || 'Research the ones with due = true; skip ones with due = false unless you have time left (they were '
      || 'checked recently or have been quiet). For each artist: only look for news dated on or after '
      || 'search_since (null means never checked: do a full sweep). Skip anything in recently_added, '
      || 'already_handled or open_discoveries without checking it. Check the rest with check_candidates '
      || '(up to 50 titles in one call) before submitting. needs_status lists songs whose status is unknown: '
      || 'find out whether each is released, leaked, a snippet etc., submit what you can prove, then call '
      || 'mark_checked with the track_ids. Always call finish_run at the end with every artist you researched.'
  );
end;
$$;

-- Admin view of the queue.
create or replace function admin_artist_queue(p_limit int default 100)
returns table (
  artist_id text, name text, score numeric, due boolean, next_due_at timestamptz,
  track_count bigint, followers bigint, requests bigint, last_checked_at timestamptz,
  quiet_streak int, reasons text[]
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select * from sc_artist_queue(p_limit, false) where is_admin();
$$;

-- Existing artists: due now, so the queue starts from today.
update artist_research_state set next_due_at = coalesce(next_due_at, now()) where next_due_at is null;

revoke execute on function sc_record_check(text, int, uuid), sc_artist_queue(int, boolean),
  sc_claim_artists(text, int, int) from public, anon, authenticated;
grant execute on function sc_claim_artists(text, int, int), sc_record_check(text, int, uuid) to service_role;
revoke execute on function rpc_request_artist_check(text), admin_artist_queue(int) from public, anon;
grant execute on function rpc_request_artist_check(text), admin_artist_queue(int) to authenticated;
