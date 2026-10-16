-- Links and duplicate cleanup
--
-- 1. Titles match ignoring spaces too ("GLOOM ROOM" = "GLOOMROOM").
-- 2. A song already on a collaborator's page is matched (and linked) instead
--    of being added again.
-- 3. Approved discoveries get a listen link (Spotify preferred, otherwise the
--    best official link); leak uploads become link suggestions.
-- 4. Duplicate cleanup: find_duplicate_groups lists likely duplicates,
--    routines can vouch for them with rpc_report_duplicate, and the admin
--    merges with admin_merge_duplicates (collections, ratings, comments,
--    versions and link suggestions move to the kept track) or dismisses them.
--
-- Run in the Supabase SQL Editor. Wrapped in a transaction.

begin;

-- 1. Space-insensitive title key ---------------------------------------------

create or replace function public.sc_title_key(t text)
returns text
language sql
immutable
as $$
  select replace(sc_normalize_title(t), ' ', '')
$$;

create or replace function public.sc_match_tracks(p_artist_id text, p_title text)
returns table (track_id text, title text, release_status text, is_version boolean)
language sql
stable
security definer
set search_path = public
as $$
  with n as (select sc_title_key(p_title) as k)
  select tr.id, tr.title, tr.release_status, tr.parent_track_id is not null
  from tracks tr, n
  where p_artist_id is not null
    and (tr.artist_id = p_artist_id
         or exists (select 1 from track_appearances a where a.track_id = tr.id and a.artist_id = p_artist_id))
    and n.k <> ''
    and (
      sc_title_key(tr.title) = n.k
      or exists (
        select 1 from regexp_split_to_table(coalesce(tr.aliases, ''), '\s*[,;/\n]\s*') al
        where al <> '' and sc_title_key(al) = n.k))
  order by (tr.parent_track_id is not null), (tr.artist_id <> p_artist_id), tr.title
  limit 10
$$;

-- Evidence can carry a dedicated Spotify link.
alter table public.discovery_evidence add column if not exists spotify_url text;

-- 2. submit_discovery: also checks collaborators' catalogues ----------------

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
  v_spotify text := nullif(trim(p ->> 'spotify_url'), '');
  v_main_name text := nullif(trim(p ->> 'main_artist_name'), '');
  v_main text;
  v_home text;
  v_to text;
  v_full text;
  v_match record;
  v_parent_id text;
  v_base text;
  v_ver text;
  v_feat_ids text[];
  v_fid text;
  v_fp text;
  v_disc discoveries%rowtype;
  v_disc_id uuid;
  v_inserted boolean;
  v_evidence_added int;
  v_today_count int;
begin
  if uid is null then raise exception 'not signed in'; end if;
  if v_artist is null or not exists (select 1 from artists where id = v_artist) then raise exception 'unknown artist_id'; end if;
  if v_title is null then raise exception 'title is required'; end if;
  if v_source is null or v_source !~* '^https?://' then raise exception 'source_url must be an http(s) URL'; end if;
  if v_spotify is not null and v_spotify !~* '^https://open\.spotify\.com/' then v_spotify := null; end if;
  if v_type = 'PRE_SAVE' then v_type := 'PRESAVE'; end if;
  if v_type = 'LEAK' then v_type := 'LEAKED'; end if;
  if v_type = 'RELEASE' then v_type := 'RELEASED'; end if;

  select count(*) into v_today_count
  from discovery_evidence where user_id = uid and created_at > now() - interval '1 day';
  if v_today_count >= 100 then raise exception 'daily limit reached (100 findings per day)'; end if;

  if v_main_name is not null then
    v_main := sc_find_artist(v_main_name);
    if v_main = v_artist then
      v_main := null;
      v_main_name := null;
    end if;
  end if;
  v_home := coalesce(v_main, v_artist);
  v_to := sc_dev_type_status(v_type);
  v_full := v_title || coalesce(' (' || v_version || ')', '');

  v_feat_ids := sc_resolve_artists(p ->> 'featured_artists',
                                   array_remove(array[v_home, case when v_main is not null then v_artist end], null));

  -- Exact match under the followed artist, the main artist, then any
  -- collaborator (a collab often already sits on the other artist's page).
  select * into v_match from sc_match_tracks(v_artist, v_full) limit 1;
  if v_match.track_id is null and v_main is not null then
    select * into v_match from sc_match_tracks(v_main, v_full) limit 1;
  end if;
  if v_match.track_id is null then
    foreach v_fid in array v_feat_ids loop
      select * into v_match from sc_match_tracks(v_fid, v_full) limit 1;
      exit when v_match.track_id is not null;
    end loop;
  end if;

  -- No exact match: a version of a known song?
  if v_match.track_id is null then
    if v_version is null then
      select s.base, s.version into v_base, v_ver from sc_split_version(v_title) s;
    else
      v_base := v_title;
      v_ver := v_version;
    end if;
    if v_base is not null then
      select m.track_id into v_parent_id from sc_match_tracks(v_home, v_base) m where not m.is_version limit 1;
      if v_parent_id is null and v_main is not null then
        select m.track_id into v_parent_id from sc_match_tracks(v_artist, v_base) m where not m.is_version limit 1;
      end if;
      if v_parent_id is not null then
        v_title := v_base;
        v_version := v_ver;
      end if;
    end if;
  end if;

  if v_match.track_id is not null and v_to is not null and v_to <> 'removed'
     and (v_to = v_match.release_status
          or release_status_rank(v_to) < release_status_rank(v_match.release_status)) then
    return jsonb_build_object('result', 'already_known', 'track_id', v_match.track_id,
                              'current_status', v_match.release_status);
  end if;

  v_fp := v_home || '|' || sc_title_key(v_title) || '|' ||
          coalesce(sc_title_key(v_version), '') || '|' || coalesce(v_to, lower(v_type));

  insert into discoveries (
    fingerprint, artist_id, matched_track_id, title, version_hint, development_type,
    official_status, from_status, to_status, release_date, featured_artists, confidence, first_seen_by,
    main_artist_id, main_artist_name, featured_artist_ids, parent_track_id
  ) values (
    v_fp, v_artist, v_match.track_id, v_title, v_version, v_type,
    nullif(lower(p ->> 'official_status'), ''), v_match.release_status, v_to,
    nullif(p ->> 'release_date', '')::date, nullif(p ->> 'featured_artists', ''),
    least(greatest(coalesce(nullif(p ->> 'confidence', '')::numeric, 0.5), 0), 1), uid,
    v_main, v_main_name, v_feat_ids, v_parent_id
  )
  on conflict (fingerprint) do update set
    last_seen_at = now(),
    matched_track_id = coalesce(discoveries.matched_track_id, excluded.matched_track_id),
    main_artist_id = coalesce(discoveries.main_artist_id, excluded.main_artist_id),
    main_artist_name = coalesce(discoveries.main_artist_name, excluded.main_artist_name),
    parent_track_id = coalesce(discoveries.parent_track_id, excluded.parent_track_id),
    featured_artist_ids = array(select distinct unnest(discoveries.featured_artist_ids || excluded.featured_artist_ids)),
    featured_artists = coalesce(discoveries.featured_artists, excluded.featured_artists)
  returning id, (xmax = 0) into v_disc_id, v_inserted;

  insert into discovery_evidence (
    discovery_id, user_id, source_url, source_layer, official_listening_url,
    unofficial_listening_url, spotify_url, date_surfaced, notes
  ) values (
    v_disc_id, uid, v_source, nullif(lower(p ->> 'source_layer'), ''),
    nullif(p ->> 'official_listening_url', ''), nullif(p ->> 'unofficial_listening_url', ''), v_spotify,
    nullif(p ->> 'date_surfaced', '')::date, left(nullif(p ->> 'notes', ''), 2000)
  )
  on conflict (discovery_id, source_url) do update set
    spotify_url = coalesce(discovery_evidence.spotify_url, excluded.spotify_url),
    official_listening_url = coalesce(discovery_evidence.official_listening_url, excluded.official_listening_url),
    unofficial_listening_url = coalesce(discovery_evidence.unofficial_listening_url, excluded.unofficial_listening_url)
  where discovery_evidence.spotify_url is null and excluded.spotify_url is not null;
  get diagnostics v_evidence_added = row_count;

  if not v_inserted then
    update discoveries d set
      corroboration_count = (select count(distinct e.user_id) from discovery_evidence e where e.discovery_id = d.id),
      confidence = greatest(coalesce(d.confidence, 0),
                            least(greatest(coalesce(nullif(p ->> 'confidence', '')::numeric, 0), 0), 1))
    where d.id = v_disc_id;
  end if;

  select * into v_disc from discoveries where id = v_disc_id;

  return jsonb_build_object(
    'result', case when v_inserted then 'created' when v_evidence_added = 0 then 'duplicate' else 'corroborated' end,
    'discovery_id', v_disc.id,
    'matched_track_id', v_disc.matched_track_id,
    'filed_under_artist_id', v_home,
    'is_feature', v_main is not null,
    'main_artist_not_in_archive', v_main_name is not null and v_main is null,
    'version_of_track_id', v_disc.parent_track_id,
    'featured_artist_ids', to_jsonb(v_disc.featured_artist_ids),
    'corroborations', v_disc.corroboration_count,
    'state', v_disc.state
  );
end;
$$;

-- 3. promote_discovery: carries links and collaborator links -----------------

create or replace function public.promote_discovery(p_discovery_id uuid, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  d discoveries%rowtype;
  ev record;
  v_link text;
  v_candidate text;
  v_owner text;
  v_link_ids text[];
  v_sub uuid;
  v_type text;
  v_sub_artist text;
  v_payload jsonb;
  v_notes text;
  v_status text;
  v_followed_name text;
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  select * into d from discoveries where id = p_discovery_id for update;
  if d.id is null then raise exception 'discovery not found'; end if;
  if d.state <> 'open' then raise exception 'discovery is already %', d.state; end if;

  select
    string_agg(distinct source_url, E'\n') as sources,
    max(spotify_url) as spotify,
    max(official_listening_url) filter (where official_listening_url ilike '%open.spotify.com%') as official_spotify,
    max(official_listening_url) filter (where official_listening_url ilike '%music.apple.com%') as apple,
    max(official_listening_url) as official_any,
    max(unofficial_listening_url) as unofficial
  into ev from discovery_evidence where discovery_id = d.id;

  -- Listen link: Spotify first (it also powers Spotify Import), then any
  -- official link. A leak upload becomes a link suggestion instead.
  v_link := coalesce(ev.spotify, ev.official_spotify, ev.apple, ev.official_any);
  v_candidate := case when v_link is null then ev.unofficial end;

  select name into v_followed_name from artists where id = d.artist_id;

  v_notes := concat_ws(E'\n',
    'Found by ChatGPT routine (' || d.development_type || ', ' || d.corroboration_count || ' contributor(s)).',
    case when d.main_artist_name is not null and d.main_artist_id is null then
      'Main artist "' || d.main_artist_name || '" is not in the archive yet, so this would land on '
      || coalesce(v_followed_name, d.artist_id) || '''s page. Add the artist first if you want it filed under them.' end,
    'Sources:', ev.sources,
    case when ev.unofficial is not null then 'Unofficial listen: ' || ev.unofficial end,
    p_note);

  v_status := coalesce(d.to_status, 'leaked');

  if d.matched_track_id is not null then
    select artist_id into v_owner from tracks where id = d.matched_track_id;
    -- Everyone on this song who isn't its owner gets linked to it.
    select coalesce(array_agg(distinct a), '{}') into v_link_ids
    from unnest(array[d.artist_id, d.main_artist_id] || coalesce(d.featured_artist_ids, '{}')) a
    where a is not null and a <> v_owner;
  end if;

  if d.matched_track_id is not null and d.to_status is not null then
    v_type := 'status_change';
    v_sub_artist := d.artist_id;
    v_payload := jsonb_strip_nulls(jsonb_build_object(
      'track_id', d.matched_track_id, 'from_status', d.from_status, 'to_status', d.to_status,
      'release_date', d.release_date, 'spotify_url', v_link, 'link_candidate_url', v_candidate,
      'notes', v_notes, 'discovery_id', d.id))
      || jsonb_build_object('appearance_artist_ids', to_jsonb(coalesce(v_link_ids, '{}')));

  elsif d.matched_track_id is not null then
    v_type := 'correction';
    v_sub_artist := d.artist_id;
    v_payload := jsonb_strip_nulls(jsonb_build_object(
      'track_id', d.matched_track_id, 'release_date', d.release_date,
      'featured_artists', d.featured_artists, 'notes', v_notes, 'discovery_id', d.id));

  elsif d.parent_track_id is not null then
    v_type := 'new_version';
    select artist_id into v_sub_artist from tracks where id = d.parent_track_id;
    v_payload := jsonb_strip_nulls(jsonb_build_object(
      'title', d.title || coalesce(' (' || d.version_hint || ')', ''),
      'parent_track_id', d.parent_track_id,
      'spotify_url', v_link,
      'link_candidate_url', v_candidate,
      'track_type', 'alternate_version',
      'is_featured', false,
      'is_official', v_status = 'released',
      'has_audio', v_status in ('snippet', 'leaked', 'released'),
      'release_date', d.release_date,
      'featured_artists', d.featured_artists,
      'release_status', v_status,
      'notes', v_notes,
      'discovery_id', d.id)) || jsonb_build_object('featured_artist_ids', to_jsonb(d.featured_artist_ids));

  else
    v_type := 'new_track';
    v_sub_artist := d.artist_id;
    v_payload := jsonb_strip_nulls(jsonb_build_object(
      'title', d.title || coalesce(' (' || d.version_hint || ')', ''),
      'spotify_url', v_link,
      'link_candidate_url', v_candidate,
      'track_type', 'studio',
      'is_featured', d.main_artist_id is not null,
      'main_artist_id', d.main_artist_id,
      'is_official', v_status = 'released',
      'has_audio', v_status in ('snippet', 'leaked', 'released'),
      'release_date', d.release_date,
      'featured_artists', d.featured_artists,
      'release_status', v_status,
      'notes', v_notes,
      'discovery_id', d.id)) || jsonb_build_object('featured_artist_ids', to_jsonb(d.featured_artist_ids));
  end if;

  insert into submissions (type, artist_id, payload, submitted_by)
  values (v_type, v_sub_artist, v_payload, d.first_seen_by)
  returning id into v_sub;

  update discoveries set
    state = 'promoted', submission_id = v_sub,
    reviewed_at = now(), reviewed_by = auth.uid(), review_note = p_note
  where id = d.id;

  return v_sub;
end;
$$;

-- Adds a link suggestion for a track (shown on the artist page for voting).
create or replace function public.sc_add_link_candidate(p_track_id text, p_url text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_track_id is null or nullif(p_url, '') is null or p_url !~* '^https?://' then return; end if;
  if exists (select 1 from track_link_candidates where track_id = p_track_id and url = p_url) then return; end if;
  insert into track_link_candidates (track_id, artist_id, url, title, source_domain)
  select t.id, t.artist_id, p_url, t.title, substring(p_url from '^https?://(?:www\.)?([^/]+)')
  from tracks t where t.id = p_track_id;
end;
$$;

-- status_change approval: also sets the link and links collaborators.
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
  if not is_admin() then raise exception 'not authorized'; end if;
  select * into sub from submissions where id = submission_id;
  if sub.id is null or sub.type <> 'status_change' then raise exception 'not a status_change submission'; end if;
  v_track := sub.payload ->> 'track_id';

  perform set_config('static_cuts.submission_id', sub.id::text, true);
  update tracks set
    release_status = sub.payload ->> 'to_status',
    release_date = coalesce(nullif(sub.payload ->> 'release_date', '')::date, release_date),
    spotify_url = coalesce(spotify_url, nullif(sub.payload ->> 'spotify_url', ''))
  where id = v_track;
  perform set_config('static_cuts.submission_id', '', true);

  insert into track_appearances (track_id, artist_id)
  select v_track, a
  from jsonb_array_elements_text(coalesce(sub.payload -> 'appearance_artist_ids', '[]'::jsonb)) a
  where exists (select 1 from artists where id = a)
    and a <> (select artist_id from tracks where id = v_track)
  on conflict (track_id, artist_id) do nothing;

  perform sc_add_link_candidate(v_track, sub.payload ->> 'link_candidate_url');

  update submissions set
    status = 'approved', reviewed_at = now(), reviewed_by = auth.uid(),
    resulting_id = v_track, reviewer_note = coalesce(p_note, reviewer_note)
  where id = submission_id;

  return v_track;
end;
$$;

-- New tracks from discoveries: apply release status and link suggestion.
create or replace function public.submissions_apply_release_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved'
     and new.type in ('new_track', 'new_version')
     and new.resulting_id is not null then
    if nullif(new.payload ->> 'release_status', '') is not null then
      update tracks set release_status = new.payload ->> 'release_status' where id = new.resulting_id;
    end if;
    if exists (select 1 from tracks where id = new.resulting_id and spotify_url is null) then
      perform sc_add_link_candidate(new.resulting_id, new.payload ->> 'link_candidate_url');
    end if;
  end if;
  return new;
end;
$$;

-- 4. Duplicate cleanup --------------------------------------------------------

create table if not exists public.duplicate_dismissals (
  group_id text primary key,
  track_ids text[] not null,
  dismissed_by uuid,
  dismissed_at timestamptz not null default now()
);

create table if not exists public.duplicate_reports (
  id uuid primary key default gen_random_uuid(),
  group_id text not null,
  track_ids text[] not null,
  user_id uuid not null,
  verdict text not null,
  confidence numeric,
  source_url text,
  notes text,
  created_at timestamptz not null default now(),
  unique (group_id, user_id),
  constraint duplicate_reports_verdict_check check (verdict in ('same', 'different')),
  constraint duplicate_reports_confidence_check check (confidence is null or (confidence >= 0 and confidence <= 1))
);

alter table public.duplicate_dismissals enable row level security;
alter table public.duplicate_reports enable row level security;
drop policy if exists "Admin reads dismissals" on public.duplicate_dismissals;
create policy "Admin reads dismissals" on public.duplicate_dismissals for select using (public.is_admin());
drop policy if exists "Admin or owner reads duplicate reports" on public.duplicate_reports;
create policy "Admin or owner reads duplicate reports" on public.duplicate_reports for select
  using (public.is_admin() or auth.uid() = user_id);

-- Stable id for a set of tracks: their sorted ids.
create or replace function public.sc_group_id(p_track_ids text[])
returns text
language sql
immutable
as $$
  select string_agg(x, ',' order by x) from unnest(p_track_ids) x
$$;

-- Titles too generic to treat as the same song across artists.
create or replace function public.sc_is_generic_title(p_key text)
returns boolean
language sql
immutable
as $$
  select length(coalesce(p_key, '')) < 4
      or p_key ~ '^(untitled|intro|outro|interlude|skit|freestyle|demo|instrumental|beat|snippet|unknown|unreleased|test|track|song|idea|jam|loop|reference|prelude|bonus)[0-9]*$'
$$;

-- Likely duplicate main tracks (not sub-versions), grouped by title key
-- (ignoring case, spaces, punctuation and feat. tags):
--   * the same title on artists who really work together (share 5+ titles
--     and 10% of the smaller catalogue, or are already linked); or
--   * the same title twice on one artist's page.
-- Generic titles (Intro, Untitled, Freestyle...) are left out.
create or replace function public.find_duplicate_groups(
  p_artist_id text default null,
  p_limit int default 20,
  p_offset int default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
  total int;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;

  with k as (
    select id, artist_id, sc_title_key(title) as key
    from tracks
    where parent_track_id is null
  ),
  kg as (
    select * from k where key <> '' and not sc_is_generic_title(key)
  ),
  sz as (
    select artist_id, count(distinct key)::int as n from kg group by 1
  ),
  -- Artist pairs that really work together: they share at least 5 titles
  -- and 10% of the smaller catalogue (big catalogues overlap by chance),
  -- or they're already linked through track appearances.
  pair as (
    select a.artist_id as a1, b.artist_id as a2, count(distinct a.key)::int as shared
    from kg a join kg b on a.key = b.key and a.artist_id < b.artist_id
    group by 1, 2
  ),
  linked as (
    select least(t.artist_id, ap.artist_id) as a1, greatest(t.artist_id, ap.artist_id) as a2
    from track_appearances ap join tracks t on t.id = ap.track_id
    where t.artist_id <> ap.artist_id
    group by 1, 2
  ),
  strong as (
    select p.a1, p.a2, (100 * p.shared / least(s1.n, s2.n))::int as strength
    from pair p
    join sz s1 on s1.artist_id = p.a1
    join sz s2 on s2.artist_id = p.a2
    where (p.shared >= 5 and p.shared::numeric / least(s1.n, s2.n) >= 0.10)
       or exists (select 1 from linked l where l.a1 = p.a1 and l.a2 = p.a2)
  ),
  -- Same title on collaborators' pages (only tracks of the strong pairs).
  cross_ok as (
    select a.key,
           array_agg(distinct x.id order by x.id) as ids,
           array_agg(distinct x.artist_id) as artists,
           max(st.strength) as strength
    from kg a
    join kg b on a.key = b.key and a.artist_id < b.artist_id
    join strong st on st.a1 = a.artist_id and st.a2 = b.artist_id
    cross join lateral (values (a.id, a.artist_id), (b.id, b.artist_id)) x(id, artist_id)
    group by a.key
  ),
  -- Same title twice on one artist's page, unless already in a group above.
  same_g as (
    select kg.key, array_agg(kg.id order by kg.id) as ids, array[kg.artist_id] as artists, 0 as strength
    from kg
    where not exists (select 1 from cross_ok c where c.key = kg.key and kg.id = any (c.ids))
    group by kg.key, kg.artist_id
    having count(*) > 1
  ),
  g2 as (
    select x.*, cardinality(x.artists) as na, sc_group_id(x.ids) as group_id
    from (
      select key, ids, artists, strength from cross_ok
      union all
      select key, ids, artists, strength from same_g
    ) x
  ),
  f as (
    select g2.*,
      (case when exists (select 1 from duplicate_reports r where r.group_id = g2.group_id and r.verdict = 'same') then 1000 else 0 end)
      + (case when g2.na = 1 then 500 else 0 end) + least(g2.strength, 100) as score
    from g2
    where not exists (select 1 from duplicate_dismissals dd where dd.group_id = g2.group_id)
      and not exists (
        select 1 from duplicate_reports r
        where r.group_id = g2.group_id and r.verdict = 'different'
          and not exists (select 1 from duplicate_reports r2 where r2.group_id = r.group_id and r2.verdict = 'same'))
      and (p_artist_id is null or p_artist_id = any (g2.artists)
           or exists (select 1 from unnest(g2.ids) i join track_appearances ap on ap.track_id = i where ap.artist_id = p_artist_id))
  ),
  page as (
    select *, count(*) over () as total_count
    from f
    order by score desc, key
    limit greatest(1, least(coalesce(p_limit, 20), 100))
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select
    coalesce(max(page.total_count), 0),
    coalesce(jsonb_agg(jsonb_build_object(
      'group_id', page.group_id,
      'key', page.key,
      'score', page.score,
      'same_artist', page.na = 1,
      'tracks', (
        select jsonb_agg(jsonb_build_object(
          'track_id', t.id,
          'artist_id', t.artist_id,
          'artist_name', ar.name,
          'title', t.title,
          'status', t.release_status,
          'link', t.spotify_url,
          'release_date', t.release_date,
          'aliases', t.aliases,
          'versions', (select count(*) from tracks v where v.parent_track_id = t.id),
          'collected', (select count(*) from track_ownership o where o.track_id = t.id),
          'ratings', (select count(*) from ratings r where r.track_id = t.id),
          'comments', (select count(*) from comments c where c.track_id = t.id),
          'appears_on', (select coalesce(jsonb_agg(ap.artist_id), '[]'::jsonb) from track_appearances ap where ap.track_id = t.id)
        ) order by release_status_rank(t.release_status) desc, (t.spotify_url is null), t.id)
        from tracks t join artists ar on ar.id = t.artist_id
        where t.id = any (page.ids)
      ),
      'reports', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'verdict', r.verdict, 'confidence', r.confidence, 'source_url', r.source_url, 'notes', r.notes)), '[]'::jsonb)
        from duplicate_reports r where r.group_id = page.group_id
      )
    ) order by page.score desc, page.key), '[]'::jsonb)
  into total, result
  from page;

  return jsonb_build_object('total', total, 'groups', result);
end;
$$;

-- A routine's verdict on whether a set of tracks is the same song.
create or replace function public.rpc_report_duplicate(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_ids text[];
  v_keys int;
  v_group text;
  v_verdict text := lower(nullif(p ->> 'verdict', ''));
begin
  if uid is null then raise exception 'not signed in'; end if;
  select coalesce(array_agg(distinct x), '{}') into v_ids
  from jsonb_array_elements_text(coalesce(p -> 'track_ids', '[]'::jsonb)) x;
  if array_length(v_ids, 1) is null or array_length(v_ids, 1) < 2 then
    raise exception 'track_ids needs at least two tracks';
  end if;
  if (select count(*) from tracks where id = any (v_ids)) <> array_length(v_ids, 1) then
    raise exception 'unknown track_id in track_ids';
  end if;
  if v_verdict not in ('same', 'different') then
    raise exception 'verdict must be same or different';
  end if;
  if nullif(p ->> 'source_url', '') is not null and (p ->> 'source_url') !~* '^https?://' then
    raise exception 'source_url must be an http(s) URL';
  end if;

  v_group := sc_group_id(v_ids);
  insert into duplicate_reports (group_id, track_ids, user_id, verdict, confidence, source_url, notes)
  values (v_group, v_ids, uid, v_verdict,
          least(greatest(coalesce(nullif(p ->> 'confidence', '')::numeric, 0.5), 0), 1),
          nullif(p ->> 'source_url', ''), left(nullif(p ->> 'notes', ''), 2000))
  on conflict (group_id, user_id) do update set
    verdict = excluded.verdict, confidence = excluded.confidence,
    source_url = excluded.source_url, notes = excluded.notes, created_at = now();

  return jsonb_build_object('ok', true, 'group_id', v_group);
end;
$$;

-- Merge duplicates into one kept track. Moves collections, ratings, comments,
-- sub-versions, link suggestions and artist links first, keeps the furthest
-- release status and any missing details, then uses admin_merge_track (which
-- adds the old title as an alias and records a redirect).
create or replace function public.admin_merge_duplicates(p_survivor text, p_duplicates text[])
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  s tracks%rowtype;
  d tracks%rowtype;
  v_dup text;
  merged int := 0;
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  select * into s from tracks where id = p_survivor;
  if s.id is null then raise exception 'track to keep not found'; end if;

  foreach v_dup in array coalesce(p_duplicates, '{}') loop
    continue when v_dup = p_survivor;
    select * into d from tracks where id = v_dup;
    continue when d.id is null;

    -- Sub-versions follow their parent to the kept track's page; their old
    -- artist stays linked.
    insert into track_appearances (track_id, artist_id)
    select v.id, v.artist_id from tracks v
    where v.parent_track_id = v_dup and v.artist_id is distinct from s.artist_id and v.artist_id is not null
    on conflict do nothing;
    update tracks set parent_track_id = p_survivor, artist_id = s.artist_id where parent_track_id = v_dup;

    insert into track_ownership (user_id, track_id, collected_at)
    select user_id, p_survivor, collected_at from track_ownership where track_id = v_dup
    on conflict do nothing;
    insert into ratings (user_id, track_id, value, updated_at)
    select user_id, p_survivor, value, updated_at from ratings where track_id = v_dup
    on conflict do nothing;
    update comments set track_id = p_survivor where track_id = v_dup;
    update track_link_candidates set track_id = p_survivor where track_id = v_dup;
    update discoveries set matched_track_id = p_survivor where matched_track_id = v_dup;
    update discoveries set parent_track_id = p_survivor where parent_track_id = v_dup;

    insert into track_appearances (track_id, artist_id)
    select p_survivor, artist_id from track_appearances
    where track_id = v_dup and artist_id <> s.artist_id
    on conflict do nothing;

    update tracks t set
      release_status = case
        when d.release_status <> 'removed'
             and release_status_rank(d.release_status) > release_status_rank(t.release_status)
          then d.release_status else t.release_status end,
      spotify_url = coalesce(t.spotify_url, d.spotify_url),
      release_date = coalesce(t.release_date, d.release_date),
      album = coalesce(t.album, d.album),
      producers = coalesce(t.producers, d.producers),
      featured_artists = coalesce(t.featured_artists, d.featured_artists),
      genre = coalesce(t.genre, d.genre),
      track_number = coalesce(t.track_number, d.track_number),
      notes = coalesce(t.notes, d.notes)
    where t.id = p_survivor;

    perform admin_merge_track(v_dup, p_survivor, d.artist_id);

    -- admin_merge_track links the duplicate's artist; that's only wanted
    -- when the duplicate sat on a different artist's page.
    if d.artist_id = s.artist_id then
      delete from track_appearances where track_id = p_survivor and artist_id = s.artist_id;
    end if;

    merged := merged + 1;
  end loop;

  -- The kept title shouldn't also be listed as its own alias.
  update tracks set aliases = nullif(trim(both ', ' from (
    select string_agg(a, ', ')
    from (select distinct on (sc_title_key(a)) a
          from regexp_split_to_table(coalesce(aliases, ''), '\s*,\s*') a
          where a <> '' and sc_title_key(a) <> sc_title_key(title)) x
  )), '')
  where id = p_survivor;

  return merged;
end;
$$;

create or replace function public.dismiss_duplicate_group(p_track_ids text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  insert into duplicate_dismissals (group_id, track_ids, dismissed_by)
  values (sc_group_id(p_track_ids), p_track_ids, auth.uid())
  on conflict (group_id) do nothing;
end;
$$;

-- Permissions ---------------------------------------------------------------
revoke all on function public.sc_add_link_candidate(text, text) from public, anon, authenticated;
revoke all on function public.find_duplicate_groups(text, int, int) from public, anon;
revoke all on function public.rpc_report_duplicate(jsonb) from public, anon;
revoke all on function public.admin_merge_duplicates(text, text[]) from public, anon;
revoke all on function public.dismiss_duplicate_group(text[]) from public, anon;
grant execute on function public.find_duplicate_groups(text, int, int) to authenticated;
grant execute on function public.rpc_report_duplicate(jsonb) to authenticated;
grant execute on function public.admin_merge_duplicates(text, text[]) to authenticated;
grant execute on function public.dismiss_duplicate_group(text[]) to authenticated;

commit;
