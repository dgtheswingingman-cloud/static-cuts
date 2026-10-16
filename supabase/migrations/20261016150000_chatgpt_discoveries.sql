-- ChatGPT routines as a discovery source
--
-- Adds:
--   1. Guardrails so OAuth apps (e.g. ChatGPT) signed in as a user can never act
--      as admin or write directly to user tables -- they may only call the
--      routine RPCs below.
--   2. tracks.release_status (rumored -> ... -> released / removed), kept in sync
--      with is_official, plus a history table track_status_events.
--   3. discoveries / discovery_evidence / routine_runs / artist_research_state.
--   4. Routine RPCs: rpc_research_plan, rpc_check_candidate,
--      rpc_submit_discovery, rpc_finish_run.
--   5. Admin RPCs: promote_discovery, dismiss_discovery, approve_status_change.
--
-- Safe to run once in the Supabase SQL editor. Does not change
-- approve_submission or reject_submission.

begin;

-- ---------------------------------------------------------------------------
-- 1. OAuth guardrails
-- ---------------------------------------------------------------------------

-- An OAuth access token carries a client_id claim; a normal site session does not.
create or replace function public.is_oauth_client()
returns boolean
language sql
stable
as $$
  select coalesce(auth.jwt() ->> 'client_id', '') <> ''
$$;

-- Admin only from a real site session, never through a connected app.
create or replace function public.is_admin()
returns boolean
language plpgsql
stable
as $$
begin
  return auth.email() = 'dg.theswingingman@gmail.com' and not public.is_oauth_client();
end;
$$;

-- Restrictive policies: on every public table with RLS, block direct
-- insert/update/delete from OAuth clients. Reads are unaffected.
do $$
declare
  t record;
  op text;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
  loop
    foreach op in array array['insert', 'update', 'delete'] loop
      execute format('drop policy if exists %I on public.%I', 'no_oauth_' || op, t.relname);
      if op = 'insert' then
        execute format(
          'create policy %I on public.%I as restrictive for insert to authenticated with check (not public.is_oauth_client())',
          'no_oauth_' || op, t.relname);
      else
        execute format(
          'create policy %I on public.%I as restrictive for %s to authenticated using (not public.is_oauth_client())',
          'no_oauth_' || op, t.relname, op);
      end if;
    end loop;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Release status on tracks
-- ---------------------------------------------------------------------------

create or replace function public.release_status_rank(s text)
returns int
language sql
immutable
as $$
  select case s
    when 'rumored' then 1
    when 'teased' then 2
    when 'snippet' then 3
    when 'leaked' then 4
    when 'announced' then 4
    when 'released' then 6
    when 'removed' then 7
    else 0
  end
$$;

alter table public.tracks add column if not exists release_status text;

update public.tracks
set release_status = case
  when is_official then 'released'
  when not has_audio then 'rumored'
  else 'leaked'
end
where release_status is null;

alter table public.tracks drop constraint if exists tracks_release_status_check;
alter table public.tracks add constraint tracks_release_status_check
  check (release_status in ('rumored', 'teased', 'snippet', 'leaked', 'announced', 'released', 'removed'));

-- Keep release_status and is_official consistent, whichever one gets written.
create or replace function public.tracks_sync_release_status()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.release_status is null then
      new.release_status := case
        when new.is_official then 'released'
        when not new.has_audio then 'rumored'
        else 'leaked'
      end;
    else
      new.is_official := (new.release_status = 'released');
    end if;
    return new;
  end if;

  if new.release_status is distinct from old.release_status then
    new.is_official := (new.release_status = 'released');
  elsif new.is_official is distinct from old.is_official then
    if new.is_official then
      new.release_status := 'released';
    elsif old.release_status = 'released' then
      new.release_status := 'leaked';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists tracks_sync_release_status on public.tracks;
create trigger tracks_sync_release_status
  before insert or update of is_official, release_status on public.tracks
  for each row execute function public.tracks_sync_release_status();

alter table public.tracks alter column release_status set not null;

create table if not exists public.track_status_events (
  id uuid primary key default gen_random_uuid(),
  track_id text not null references public.tracks(id) on delete cascade,
  from_status text,
  to_status text not null,
  source_submission_id uuid references public.submissions(id) on delete set null,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists track_status_events_track_idx on public.track_status_events (track_id, created_at desc);

alter table public.track_status_events enable row level security;
drop policy if exists "Public can read status events" on public.track_status_events;
create policy "Public can read status events" on public.track_status_events for select using (true);

-- Log every status change. approve_status_change sets static_cuts.submission_id
-- so the event links back to the evidence.
create or replace function public.tracks_log_status_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.release_status is distinct from old.release_status then
    insert into track_status_events (track_id, from_status, to_status, source_submission_id, created_by)
    values (
      new.id, old.release_status, new.release_status,
      nullif(current_setting('static_cuts.submission_id', true), '')::uuid,
      auth.uid()
    );
  end if;
  return new;
end;
$$;

drop trigger if exists tracks_log_status_event on public.tracks;
create trigger tracks_log_status_event
  after update of release_status, is_official on public.tracks
  for each row execute function public.tracks_log_status_event();

-- When an approved new_track / new_version submission carries a release_status
-- (set by promote_discovery), apply it to the track approve_submission created.
create or replace function public.submissions_apply_release_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved'
     and new.type in ('new_track', 'new_version')
     and new.resulting_id is not null
     and nullif(new.payload ->> 'release_status', '') is not null then
    update tracks set release_status = new.payload ->> 'release_status' where id = new.resulting_id;
  end if;
  return new;
end;
$$;

drop trigger if exists submissions_apply_release_status on public.submissions;
create trigger submissions_apply_release_status
  after update of status on public.submissions
  for each row execute function public.submissions_apply_release_status();

-- ---------------------------------------------------------------------------
-- 3. Discovery tables
-- ---------------------------------------------------------------------------

create table if not exists public.discoveries (
  id uuid primary key default gen_random_uuid(),
  fingerprint text not null unique,
  artist_id text not null references public.artists(id) on delete cascade,
  matched_track_id text references public.tracks(id) on delete set null,
  title text not null,
  version_hint text,
  development_type text not null,
  official_status text,
  from_status text,
  to_status text,
  release_date date,
  featured_artists text,
  confidence numeric,
  first_seen_by uuid,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  corroboration_count int not null default 1,
  state text not null default 'open',
  submission_id uuid references public.submissions(id) on delete set null,
  reviewed_at timestamptz,
  reviewed_by uuid,
  review_note text,
  constraint discoveries_dev_type_check check (development_type in (
    'RELEASED', 'ANNOUNCED', 'LEAKED', 'SNIPPET', 'TEASER', 'LIVE_PREVIEW', 'PREORDER', 'PRESAVE',
    'RUMOR', 'TAKEDOWN', 'EARLY_UPLOAD', 'DATE_CHANGE', 'TRACKLIST', 'COVER_ART', 'FEATURE',
    'REISSUE', 'ARCHIVAL', 'OTHER')),
  constraint discoveries_official_check check (official_status is null or official_status in ('official', 'unofficial', 'unconfirmed')),
  constraint discoveries_state_check check (state in ('open', 'promoted', 'dismissed', 'stale')),
  constraint discoveries_confidence_check check (confidence is null or (confidence >= 0 and confidence <= 1))
);
create index if not exists discoveries_open_idx on public.discoveries (state, last_seen_at desc);
create index if not exists discoveries_artist_idx on public.discoveries (artist_id);

create table if not exists public.discovery_evidence (
  id uuid primary key default gen_random_uuid(),
  discovery_id uuid not null references public.discoveries(id) on delete cascade,
  user_id uuid,
  source_url text not null,
  source_layer text,
  official_listening_url text,
  unofficial_listening_url text,
  date_surfaced date,
  notes text,
  created_at timestamptz not null default now(),
  unique (discovery_id, source_url),
  constraint discovery_evidence_layer_check check (source_layer is null or source_layer in ('official', 'database', 'community'))
);
create index if not exists discovery_evidence_user_idx on public.discovery_evidence (user_id, created_at desc);

create table if not exists public.routine_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  client_id text,
  started_at timestamptz not null default now(),
  artists_checked int,
  findings int,
  submitted int,
  summary text
);
create index if not exists routine_runs_user_idx on public.routine_runs (user_id, started_at desc);

create table if not exists public.artist_research_state (
  artist_id text primary key references public.artists(id) on delete cascade,
  last_researched_at timestamptz,
  last_researched_by uuid,
  research_count int not null default 0
);

alter table public.discoveries enable row level security;
alter table public.discovery_evidence enable row level security;
alter table public.routine_runs enable row level security;
alter table public.artist_research_state enable row level security;

-- Reads only; all writes go through security-definer functions.
drop policy if exists "Admin reads discoveries" on public.discoveries;
create policy "Admin reads discoveries" on public.discoveries for select using (public.is_admin());
drop policy if exists "Admin or owner reads evidence" on public.discovery_evidence;
create policy "Admin or owner reads evidence" on public.discovery_evidence for select
  using (public.is_admin() or auth.uid() = user_id);
drop policy if exists "Admin or owner reads runs" on public.routine_runs;
create policy "Admin or owner reads runs" on public.routine_runs for select
  using (public.is_admin() or auth.uid() = user_id);
drop policy if exists "Public reads research state" on public.artist_research_state;
create policy "Public reads research state" on public.artist_research_state for select using (true);

-- ---------------------------------------------------------------------------
-- 4. Matching helpers
-- ---------------------------------------------------------------------------

-- Lowercase, drop (feat. ...) / [prod. ...] tags, curly quotes, trailing *,
-- punctuation, and collapse whitespace. Version hints in brackets like
-- (Demo) are kept, so a demo never matches the main track.
create or replace function public.sc_normalize_title(t text)
returns text
language sql
immutable
as $$
  select trim(regexp_replace(
    regexp_replace(
      regexp_replace(
        lower(coalesce(t, '')),
        '\s*[\(\[]\s*(feat\.?|ft\.?|featuring|prod\.?|produced by)\s[^\)\]]*[\)\]]', '', 'g'),
      '[*''’‘"“”.,!?:]+', '', 'g'),
    '\s+', ' ', 'g'))
$$;

-- Status a development type moves a track to (null = not a status change).
create or replace function public.sc_dev_type_status(d text)
returns text
language sql
immutable
as $$
  select case d
    when 'RUMOR' then 'rumored'
    when 'TEASER' then 'teased'
    when 'SNIPPET' then 'snippet'
    when 'LIVE_PREVIEW' then 'snippet'
    when 'LEAKED' then 'leaked'
    when 'EARLY_UPLOAD' then 'leaked'
    when 'ANNOUNCED' then 'announced'
    when 'PREORDER' then 'announced'
    when 'PRESAVE' then 'announced'
    when 'RELEASED' then 'released'
    when 'TAKEDOWN' then 'removed'
    else null
  end
$$;

-- Tracks of an artist (home artist or appearance) whose title or an alias
-- normalises to the same text.
create or replace function public.sc_match_tracks(p_artist_id text, p_title text)
returns table (track_id text, title text, release_status text, is_version boolean)
language sql
stable
security definer
set search_path = public
as $$
  with n as (select sc_normalize_title(p_title) as t)
  select tr.id, tr.title, tr.release_status, tr.parent_track_id is not null
  from tracks tr, n
  where (tr.artist_id = p_artist_id
         or exists (select 1 from track_appearances a where a.track_id = tr.id and a.artist_id = p_artist_id))
    and n.t <> ''
    and (
      sc_normalize_title(tr.title) = n.t
      or exists (
        select 1
        from regexp_split_to_table(coalesce(tr.aliases, ''), '\s*[,;/\n]\s*') al
        where al <> '' and sc_normalize_title(al) = n.t
      )
    )
  order by (tr.parent_track_id is not null), tr.title
  limit 10
$$;

-- ---------------------------------------------------------------------------
-- 5. Routine RPCs (callable by a signed-in user, including through OAuth)
-- ---------------------------------------------------------------------------

-- Which of my followed artists to research now, stalest first, with a compact
-- snapshot. Full tracklists are not returned (some artists have thousands of
-- tracks); use rpc_check_candidate per finding instead.
create or replace function public.rpc_research_plan(p_limit int default 15)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  result jsonb;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;

  select coalesce(jsonb_agg(x order by x->>'_sort'), '[]'::jsonb) into result
  from (
    select jsonb_build_object(
      '_sort', coalesce(to_char(rs.last_researched_at, 'YYYY-MM-DD"T"HH24:MI:SS'), '0000'),
      'artist_id', ar.id,
      'name', ar.name,
      'last_researched_at', rs.last_researched_at,
      'researched_recently', coalesce(rs.last_researched_at > now() - interval '12 hours', false),
      'known_track_count', (select count(*) from tracks t where t.artist_id = ar.id),
      'watch_list', coalesce((
        select jsonb_agg(jsonb_build_object('track_id', t.id, 'title', t.title, 'status', t.release_status))
        from (
          select id, title, release_status from tracks t
          where t.artist_id = ar.id and t.release_status in ('rumored', 'teased', 'snippet', 'announced')
          order by title limit 100
        ) t
      ), '[]'::jsonb),
      'open_discoveries', coalesce((
        select jsonb_agg(jsonb_build_object('title', d.title, 'to_status', d.to_status, 'type', d.development_type))
        from (
          select title, to_status, development_type from discoveries d
          where d.artist_id = ar.id and d.state = 'open'
          order by last_seen_at desc limit 50
        ) d
      ), '[]'::jsonb)
    ) as x
    from follows f
    join artists ar on ar.id = f.artist_id
    left join artist_research_state rs on rs.artist_id = ar.id
    where f.user_id = uid
    order by rs.last_researched_at nulls first
    limit greatest(1, least(coalesce(p_limit, 15), 50))
  ) s;

  return jsonb_build_object(
    'artists', (select coalesce(jsonb_agg(e - '_sort'), '[]'::jsonb) from jsonb_array_elements(result) e),
    'note', 'Call check_candidate before submitting anything. Skip artists with researched_recently = true unless you have time left.'
  );
end;
$$;

-- Is this title already in Static Cuts, and has its status moved on?
create or replace function public.rpc_check_candidate(
  p_artist_id text,
  p_title text,
  p_observed_status text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  matches jsonb;
  best record;
  open_disc record;
  verdict text;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  if not exists (select 1 from artists where id = p_artist_id) then
    raise exception 'unknown artist_id %', p_artist_id;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'track_id', m.track_id, 'title', m.title, 'status', m.release_status, 'is_version', m.is_version)), '[]'::jsonb)
  into matches
  from sc_match_tracks(p_artist_id, p_title) m;

  select * into best from sc_match_tracks(p_artist_id, p_title) limit 1;

  select id, to_status, development_type, corroboration_count into open_disc
  from discoveries
  where artist_id = p_artist_id and state = 'open'
    and sc_normalize_title(title) = sc_normalize_title(p_title)
  order by last_seen_at desc
  limit 1;

  if best.track_id is null then
    verdict := case when open_disc.id is not null then 'open_discovery' else 'new' end;
  elsif p_observed_status is not null
        and p_observed_status <> best.release_status
        and (p_observed_status = 'removed'
             or release_status_rank(p_observed_status) >= release_status_rank(best.release_status)) then
    verdict := 'known_status_changed';
  else
    verdict := 'known_same_status';
  end if;

  return jsonb_build_object(
    'verdict', verdict,
    'matches', matches,
    'open_discovery', case when open_disc.id is null then null else jsonb_build_object(
      'id', open_disc.id, 'to_status', open_disc.to_status,
      'type', open_disc.development_type, 'corroborations', open_disc.corroboration_count) end
  );
end;
$$;

-- Record a finding. Merges into an existing discovery by fingerprint; the
-- same source URL is never stored twice. Nothing here touches tracks.
create or replace function public.rpc_submit_discovery(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_artist text := p ->> 'artist_id';
  v_title text := nullif(trim(p ->> 'title'), '');
  v_type text := upper(replace(replace(coalesce(p ->> 'development_type', ''), '-', '_'), ' ', '_'));
  v_version text := nullif(trim(p ->> 'version_hint'), '');
  v_source text := nullif(trim(p ->> 'source_url'), '');
  v_to text;
  v_match record;
  v_fp text;
  v_disc discoveries%rowtype;
  v_disc_id uuid;
  v_inserted boolean;
  v_evidence_added int;
  v_today_count int;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;
  if v_artist is null or not exists (select 1 from artists where id = v_artist) then
    raise exception 'unknown artist_id';
  end if;
  if v_title is null then
    raise exception 'title is required';
  end if;
  if v_source is null or v_source !~* '^https?://' then
    raise exception 'source_url must be an http(s) URL';
  end if;
  if v_type = 'PRE_SAVE' then v_type := 'PRESAVE'; end if;
  if v_type = 'LEAK' then v_type := 'LEAKED'; end if;
  if v_type = 'RELEASE' then v_type := 'RELEASED'; end if;

  select count(*) into v_today_count
  from discovery_evidence where user_id = uid and created_at > now() - interval '1 day';
  if v_today_count >= 100 then
    raise exception 'daily limit reached (100 findings per day)';
  end if;

  v_to := sc_dev_type_status(v_type);
  select * into v_match
  from sc_match_tracks(v_artist, coalesce(v_title || ' (' || v_version || ')', v_title))
  limit 1;
  if v_match.track_id is null and v_version is null then
    select * into v_match from sc_match_tracks(v_artist, v_title) limit 1;
  end if;

  -- Already in the catalogue at this status (or further along): nothing to do.
  if v_match.track_id is not null and v_to is not null and v_to <> 'removed'
     and (v_to = v_match.release_status
          or release_status_rank(v_to) < release_status_rank(v_match.release_status)) then
    return jsonb_build_object('result', 'already_known', 'track_id', v_match.track_id,
                              'current_status', v_match.release_status);
  end if;

  v_fp := v_artist || '|' || sc_normalize_title(v_title) || '|' ||
          coalesce(sc_normalize_title(v_version), '') || '|' || coalesce(v_to, lower(v_type));

  insert into discoveries (
    fingerprint, artist_id, matched_track_id, title, version_hint, development_type,
    official_status, from_status, to_status, release_date, featured_artists, confidence, first_seen_by
  ) values (
    v_fp, v_artist, v_match.track_id, v_title, v_version, v_type,
    nullif(lower(p ->> 'official_status'), ''),
    v_match.release_status, v_to,
    nullif(p ->> 'release_date', '')::date,
    nullif(p ->> 'featured_artists', ''),
    least(greatest(coalesce(nullif(p ->> 'confidence', '')::numeric, 0.5), 0), 1),
    uid
  )
  on conflict (fingerprint) do update set last_seen_at = now()
  returning id, (xmax = 0) into v_disc_id, v_inserted;

  select * into v_disc from discoveries where id = v_disc_id;

  insert into discovery_evidence (
    discovery_id, user_id, source_url, source_layer, official_listening_url,
    unofficial_listening_url, date_surfaced, notes
  ) values (
    v_disc.id, uid, v_source, nullif(lower(p ->> 'source_layer'), ''),
    nullif(p ->> 'official_listening_url', ''), nullif(p ->> 'unofficial_listening_url', ''),
    nullif(p ->> 'date_surfaced', '')::date, left(nullif(p ->> 'notes', ''), 2000)
  )
  on conflict (discovery_id, source_url) do nothing;
  get diagnostics v_evidence_added = row_count;

  if not v_inserted then
    update discoveries d set corroboration_count = (
      select count(distinct e.user_id) from discovery_evidence e where e.discovery_id = d.id
    ),
    confidence = greatest(coalesce(d.confidence, 0), least(greatest(coalesce(nullif(p ->> 'confidence', '')::numeric, 0), 0), 1))
    where d.id = v_disc.id;

    select * into v_disc from discoveries where id = v_disc_id;
  end if;

  return jsonb_build_object(
    'result', case
      when v_inserted then 'created'
      when v_evidence_added = 0 then 'duplicate'
      else 'corroborated' end,
    'discovery_id', v_disc.id,
    'matched_track_id', v_disc.matched_track_id,
    'corroborations', v_disc.corroboration_count,
    'state', v_disc.state
  );
end;
$$;

-- Close a run: logs it and marks the artists as researched so other users'
-- routines can skip them for a while.
create or replace function public.rpc_finish_run(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_ids text[];
begin
  if uid is null then
    raise exception 'not signed in';
  end if;

  select coalesce(array_agg(x), '{}') into v_ids
  from jsonb_array_elements_text(coalesce(p -> 'artist_ids', '[]'::jsonb)) x
  where exists (select 1 from follows f where f.user_id = uid and f.artist_id = x);

  insert into artist_research_state (artist_id, last_researched_at, last_researched_by, research_count)
  select a, now(), uid, 1 from unnest(v_ids) a
  on conflict (artist_id) do update set
    last_researched_at = now(),
    last_researched_by = uid,
    research_count = artist_research_state.research_count + 1;

  insert into routine_runs (user_id, client_id, artists_checked, findings, submitted, summary)
  values (
    uid, auth.jwt() ->> 'client_id', coalesce(array_length(v_ids, 1), 0),
    nullif(p ->> 'findings', '')::int, nullif(p ->> 'submitted', '')::int,
    left(nullif(p ->> 'summary', ''), 4000)
  );

  return jsonb_build_object('ok', true, 'artists_marked', coalesce(array_length(v_ids, 1), 0));
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Admin RPCs (site session only)
-- ---------------------------------------------------------------------------

-- Turn a discovery into one normal pending submission, so it goes through
-- /review like everything else.
create or replace function public.promote_discovery(p_discovery_id uuid, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  d discoveries%rowtype;
  ev record;
  v_sub uuid;
  v_type text;
  v_payload jsonb;
  v_notes text;
begin
  if not is_admin() then
    raise exception 'not authorized';
  end if;
  select * into d from discoveries where id = p_discovery_id for update;
  if d.id is null then
    raise exception 'discovery not found';
  end if;
  if d.state <> 'open' then
    raise exception 'discovery is already %', d.state;
  end if;

  select
    string_agg(distinct source_url, E'\n') as sources,
    max(official_listening_url) as official_url,
    max(unofficial_listening_url) as unofficial_url
  into ev
  from discovery_evidence where discovery_id = d.id;

  v_notes := concat_ws(E'\n',
    'Found by ChatGPT routine (' || d.development_type || ', ' || d.corroboration_count || ' contributor(s)).',
    'Sources:', ev.sources,
    case when ev.unofficial_url is not null then 'Unofficial listen: ' || ev.unofficial_url end,
    p_note);

  if d.matched_track_id is not null and d.to_status is not null then
    v_type := 'status_change';
    v_payload := jsonb_build_object(
      'track_id', d.matched_track_id,
      'from_status', d.from_status,
      'to_status', d.to_status,
      'release_date', d.release_date,
      'notes', v_notes,
      'discovery_id', d.id);
  elsif d.matched_track_id is not null then
    v_type := 'correction';
    v_payload := jsonb_strip_nulls(jsonb_build_object(
      'track_id', d.matched_track_id,
      'release_date', d.release_date,
      'featured_artists', d.featured_artists,
      'notes', v_notes,
      'discovery_id', d.id));
  else
    v_type := 'new_track';
    v_payload := jsonb_strip_nulls(jsonb_build_object(
      'title', case when d.version_hint is not null then d.title || ' (' || d.version_hint || ')' else d.title end,
      'spotify_url', case when ev.official_url ilike '%open.spotify.com%' then ev.official_url end,
      'track_type', 'studio',
      'is_featured', false,
      'is_official', coalesce(d.to_status, 'leaked') = 'released',
      'has_audio', coalesce(d.to_status, 'leaked') in ('snippet', 'leaked', 'released'),
      'release_date', d.release_date,
      'featured_artists', d.featured_artists,
      'release_status', coalesce(d.to_status, 'leaked'),
      'notes', v_notes,
      'discovery_id', d.id));
  end if;

  insert into submissions (type, artist_id, payload, submitted_by)
  values (v_type, d.artist_id, v_payload, d.first_seen_by)
  returning id into v_sub;

  update discoveries set
    state = 'promoted', submission_id = v_sub,
    reviewed_at = now(), reviewed_by = auth.uid(), review_note = p_note
  where id = d.id;

  return v_sub;
end;
$$;

create or replace function public.dismiss_discovery(p_discovery_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'not authorized';
  end if;
  update discoveries set
    state = 'dismissed', reviewed_at = now(), reviewed_by = auth.uid(), review_note = p_note
  where id = p_discovery_id and state = 'open';
end;
$$;

-- Approve a status_change submission (approve_submission doesn't know this type).
create or replace function public.approve_status_change(submission_id uuid, p_note text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  sub submissions%rowtype;
  v_track text;
begin
  if not is_admin() then
    raise exception 'not authorized';
  end if;
  select * into sub from submissions where id = submission_id;
  if sub.id is null or sub.type <> 'status_change' then
    raise exception 'not a status_change submission';
  end if;
  v_track := sub.payload ->> 'track_id';

  perform set_config('static_cuts.submission_id', sub.id::text, true);
  update tracks set
    release_status = sub.payload ->> 'to_status',
    release_date = coalesce(nullif(sub.payload ->> 'release_date', '')::date, release_date)
  where id = v_track;
  perform set_config('static_cuts.submission_id', '', true);

  update submissions set
    status = 'approved', reviewed_at = now(), reviewed_by = auth.uid(),
    resulting_id = v_track, reviewer_note = coalesce(p_note, reviewer_note)
  where id = submission_id;

  return v_track;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Permissions
-- ---------------------------------------------------------------------------

revoke all on function public.sc_match_tracks(text, text) from public, anon;
revoke all on function public.rpc_research_plan(int) from public, anon;
revoke all on function public.rpc_check_candidate(text, text, text) from public, anon;
revoke all on function public.rpc_submit_discovery(jsonb) from public, anon;
revoke all on function public.rpc_finish_run(jsonb) from public, anon;
revoke all on function public.promote_discovery(uuid, text) from public, anon;
revoke all on function public.dismiss_discovery(uuid, text) from public, anon;
revoke all on function public.approve_status_change(uuid, text) from public, anon;

grant execute on function public.sc_match_tracks(text, text) to authenticated;
grant execute on function public.rpc_research_plan(int) to authenticated;
grant execute on function public.rpc_check_candidate(text, text, text) to authenticated;
grant execute on function public.rpc_submit_discovery(jsonb) to authenticated;
grant execute on function public.rpc_finish_run(jsonb) to authenticated;
grant execute on function public.promote_discovery(uuid, text) to authenticated;
grant execute on function public.dismiss_discovery(uuid, text) to authenticated;
grant execute on function public.approve_status_change(uuid, text) to authenticated;

commit;
