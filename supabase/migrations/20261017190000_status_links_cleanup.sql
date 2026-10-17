-- Release status, ChatGPT link suggestions and clean-up tools
--
-- 1. New "unconfirmed" status for songs with no evidence either way. Songs
--    that were only marked "leaked" because the old data had no status move
--    to unconfirmed; titles like "(Demo)" or "(Snippet)" are tagged from the
--    title. Tracklist and cover art finds come in as "announced".
-- 2. ChatGPT link suggestions: routines can list songs with no link and add
--    suggestions to each song's "possible matches", with a suggested status,
--    album and release date.
-- 3. One-tap approve for routine discoveries.
-- 4. Quick merge for identical copies on one artist's page.
-- 5. Albums carried through from discoveries.
-- 6. The admin isn't held to the 3-genre-tags-per-artist limit.
-- 7. Security and speed tidy-up.
--
-- Run in the Supabase SQL Editor. Wrapped in a transaction.

begin;

-- 1. Unconfirmed status ---------------------------------------------------------

alter table public.tracks drop constraint if exists tracks_release_status_check;
alter table public.tracks add constraint tracks_release_status_check
  check (release_status in ('unconfirmed', 'rumored', 'teased', 'snippet', 'leaked', 'announced', 'released', 'removed'));

alter table public.tracks add column if not exists routine_checked_at timestamptz;

create or replace function public.release_status_rank(s text)
returns int
language sql
immutable
set search_path = public
as $$
  select case s
    when 'unconfirmed' then 0
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

-- New tracks with no status start as unconfirmed; un-ticking official on a
-- released track makes it unconfirmed rather than leaked.
create or replace function public.tracks_sync_release_status()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.release_status is null then
      new.release_status := case
        when new.is_official then 'released'
        when not new.has_audio then 'rumored'
        else 'unconfirmed'
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
      new.release_status := 'unconfirmed';
    end if;
  end if;
  return new;
end;
$$;

-- Bulk fixes can skip the per-track history (set static_cuts.skip_status_log).
create or replace function public.tracks_log_status_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('static_cuts.skip_status_log', true), '') = 'on' then
    return new;
  end if;
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

do $$ begin perform set_config('static_cuts.skip_status_log', 'on', true); end $$;

-- "Leaked" with no evidence behind it -> unconfirmed.
update public.tracks t
set release_status = 'unconfirmed'
where t.release_status = 'leaked'
  and not exists (select 1 from track_status_events e where e.track_id = t.id)
  and not exists (
    select 1 from submissions s
    left join track_redirects r on r.old_track_id = s.resulting_id
    where s.status = 'approved' and s.payload ? 'discovery_id'
      and coalesce(r.new_track_id, s.resulting_id) = t.id);

-- Title clues, only for songs we know nothing else about.
update public.tracks
set release_status = 'snippet'
where release_status = 'unconfirmed'
  and title ~* '[\(\[][^\)\]]*\m(snippet|preview)\M[^\)\]]*[\)\]]';

update public.tracks
set release_status = 'leaked'
where release_status = 'unconfirmed'
  and title ~* '[\(\[][^\)\]]*\m(demo|reference|ref|v[0-9]+|version [0-9]+|original|og|session|leak|leaked)\M[^\)\]]*[\)\]]';

do $$ begin perform set_config('static_cuts.skip_status_log', '', true); end $$;

-- Tracklist and cover art reveals mean the song is announced.
create or replace function public.sc_dev_type_status(d text)
returns text
language sql
immutable
set search_path = public
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
    when 'TRACKLIST' then 'announced'
    when 'COVER_ART' then 'announced'
    when 'RELEASED' then 'released'
    when 'TAKEDOWN' then 'removed'
    else null
  end
$$;

-- Open tracklist / cover art finds waiting for review.
update public.discoveries
set to_status = 'announced'
where state = 'open' and to_status is null and development_type in ('TRACKLIST', 'COVER_ART');

-- Albums travel with discoveries.
alter table public.discoveries add column if not exists album text;

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
  v_album text := nullif(trim(p ->> 'album'), '');
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
  -- A tracklist or cover art reveal with a Spotify track link is out already.
  if v_to = 'announced' and v_type in ('TRACKLIST', 'COVER_ART') and v_spotify is not null then
    v_to := 'released';
  end if;
  -- An archival release or reissue with official evidence is a release.
  if v_to is null and v_type in ('ARCHIVAL', 'REISSUE')
     and (lower(coalesce(p ->> 'official_status', '')) = 'official'
          or v_spotify is not null
          or nullif(p ->> 'official_listening_url', '') is not null) then
    v_to := 'released';
  end if;
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
    main_artist_id, main_artist_name, featured_artist_ids, parent_track_id, album
  ) values (
    v_fp, v_artist, v_match.track_id, v_title, v_version, v_type,
    nullif(lower(p ->> 'official_status'), ''), v_match.release_status, v_to,
    nullif(p ->> 'release_date', '')::date, nullif(p ->> 'featured_artists', ''),
    least(greatest(coalesce(nullif(p ->> 'confidence', '')::numeric, 0.5), 0), 1), uid,
    v_main, v_main_name, v_feat_ids, v_parent_id, v_album
  )
  on conflict (fingerprint) do update set
    last_seen_at = now(),
    matched_track_id = coalesce(discoveries.matched_track_id, excluded.matched_track_id),
    main_artist_id = coalesce(discoveries.main_artist_id, excluded.main_artist_id),
    main_artist_name = coalesce(discoveries.main_artist_name, excluded.main_artist_name),
    parent_track_id = coalesce(discoveries.parent_track_id, excluded.parent_track_id),
    featured_artist_ids = array(select distinct unnest(discoveries.featured_artist_ids || excluded.featured_artist_ids)),
    featured_artists = coalesce(discoveries.featured_artists, excluded.featured_artists),
    album = coalesce(discoveries.album, excluded.album),
    release_date = coalesce(discoveries.release_date, excluded.release_date)
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

  if v_match.track_id is not null then
    update tracks set routine_checked_at = now() where id = v_match.track_id;
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

  -- No status given (e.g. archival, reissue, other): released when there's
  -- official evidence, otherwise leaked.
  -- No status given (feature, other...): released when there's an official
  -- listening link, otherwise unconfirmed.
  v_status := coalesce(d.to_status,
    case when coalesce(ev.spotify, ev.official_any) is not null then 'released' else 'unconfirmed' end);

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
      'release_date', d.release_date,
      'album', d.album, 'spotify_url', v_link, 'link_candidate_url', v_candidate,
      'notes', v_notes, 'discovery_id', d.id))
      || jsonb_build_object('appearance_artist_ids', to_jsonb(coalesce(v_link_ids, '{}')));

  elsif d.matched_track_id is not null then
    v_type := 'correction';
    v_sub_artist := d.artist_id;
    v_payload := jsonb_strip_nulls(jsonb_build_object(
      'track_id', d.matched_track_id, 'release_date', d.release_date,
      'album', d.album,
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
      'has_audio', v_status in ('snippet', 'leaked', 'released', 'unconfirmed'),
      'release_date', d.release_date,
      'album', d.album,
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
      'has_audio', v_status in ('snippet', 'leaked', 'released', 'unconfirmed'),
      'release_date', d.release_date,
      'album', d.album,
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
    spotify_url = coalesce(spotify_url, nullif(sub.payload ->> 'spotify_url', '')),
    album = coalesce(album, nullif(sub.payload ->> 'album', ''))
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
      'needs_status', coalesce((
        select jsonb_agg(jsonb_build_object('track_id', t.id, 'title', t.title))
        from (
          select id, title from tracks t
          where t.artist_id = ar.id and t.release_status = 'unconfirmed' and t.parent_track_id is null
          order by t.routine_checked_at nulls first, t.title
          limit 10
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
    'note', 'Call check_candidate before submitting anything. Skip artists with researched_recently = true unless you have time left. needs_status lists songs whose status is unknown: find out whether each is released, leaked, a snippet etc., submit what you can prove, then call mark_checked with the track_ids you looked at.'
  );
end;
$$;

-- Admin can set unconfirmed by hand too.
create or replace function public.admin_set_release_status(p_track_id text, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  if p_status not in ('unconfirmed', 'rumored', 'teased', 'snippet', 'leaked', 'announced', 'released', 'removed') then
    raise exception 'unknown status %', p_status;
  end if;
  update tracks set release_status = p_status
  where id = p_track_id and release_status is distinct from p_status;
end;
$$;

-- 2. ChatGPT link suggestions ---------------------------------------------------

alter table public.track_link_candidates
  add column if not exists source text not null default 'search',
  add column if not exists suggested_by uuid,
  add column if not exists link_kind text,
  add column if not exists suggested_status text,
  add column if not exists album text,
  add column if not exists release_date date,
  add column if not exists confidence numeric,
  add column if not exists notes text;

alter table public.track_link_candidates drop constraint if exists track_link_candidates_suggested_status_check;
alter table public.track_link_candidates add constraint track_link_candidates_suggested_status_check
  check (suggested_status is null or suggested_status in ('rumored', 'teased', 'snippet', 'leaked', 'announced', 'released', 'removed'));

-- Songs by an artist with no listen link, the ones no routine has checked first.
create or replace function public.rpc_songs_needing_links(p_artist_id text, p_limit int default 25)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not exists (select 1 from artists where id = p_artist_id) then
    raise exception 'unknown artist_id %', p_artist_id;
  end if;

  select coalesce(jsonb_agg(x), '[]'::jsonb) into result
  from (
    select jsonb_build_object(
      'track_id', t.id,
      'title', t.title,
      'artist', ar.name,
      'status', t.release_status,
      'version_of', (select p.title from tracks p where p.id = t.parent_track_id),
      'already_suggested', coalesce((
        select jsonb_agg(c.url) from track_link_candidates c where c.track_id = t.id
      ), '[]'::jsonb)
    ) as x
    from tracks t
    join artists ar on ar.id = t.artist_id
    where (t.artist_id = p_artist_id
           or exists (select 1 from track_appearances a where a.track_id = t.id and a.artist_id = p_artist_id))
      and t.spotify_url is null
    order by t.routine_checked_at nulls first, (t.parent_track_id is not null), t.title
    limit greatest(1, least(coalesce(p_limit, 25), 50))
  ) s;

  return jsonb_build_object(
    'songs', result,
    'instructions',
      'For each song, search for a listen link. Released songs: the Spotify track link first, otherwise Apple Music, ' ||
      'YouTube (official channel), Bandcamp or SoundCloud. Unreleased songs: a leak or snippet upload (YouTube, ' ||
      'SoundCloud, archive pages). Make sure it is this exact song and version, not a remix or a different song with the ' ||
      'same name. Call suggest_link for each link you find, with the status it shows and the album and release date when ' ||
      'you know them. Then call mark_checked with every track_id you looked at, found or not. Reply with a short summary.'
  );
end;
$$;

-- A routine's link suggestion goes into the song's "possible matches".
create or replace function public.rpc_suggest_link(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_track tracks%rowtype;
  v_url text := nullif(trim(p ->> 'url'), '');
  v_status text := lower(nullif(trim(p ->> 'suggested_status'), ''));
  v_kind text := lower(nullif(trim(p ->> 'link_kind'), ''));
  v_count int;
  v_id uuid;
begin
  if uid is null then raise exception 'not signed in'; end if;
  select * into v_track from tracks where id = p ->> 'track_id';
  if v_track.id is null then raise exception 'unknown track_id'; end if;
  if v_url is null or v_url !~* '^https?://[^ ]+$' then raise exception 'url must be an http(s) URL'; end if;
  if v_status is not null and v_status not in ('rumored', 'teased', 'snippet', 'leaked', 'announced', 'released', 'removed') then
    raise exception 'unknown suggested_status %', v_status;
  end if;

  select count(*) into v_count from track_link_candidates
  where suggested_by = uid and found_at > now() - interval '1 day';
  if v_count >= 300 then raise exception 'daily limit reached (300 link suggestions per day)'; end if;

  update tracks set routine_checked_at = now() where id = v_track.id;

  if exists (select 1 from track_link_candidates where track_id = v_track.id and url = v_url) then
    return jsonb_build_object('result', 'duplicate');
  end if;

  insert into track_link_candidates (
    track_id, artist_id, url, title, source_domain, source, suggested_by, link_kind,
    suggested_status, album, release_date, confidence, notes
  ) values (
    v_track.id, v_track.artist_id, v_url, v_track.title,
    substring(v_url from '^https?://(?:www\.)?([^/]+)'),
    'chatgpt', uid, v_kind, v_status,
    nullif(trim(p ->> 'album'), ''),
    case when (p ->> 'release_date') ~ '^\d{4}-\d{2}-\d{2}$' then (p ->> 'release_date')::date end,
    least(greatest(coalesce(nullif(p ->> 'confidence', '')::numeric, 0.5), 0), 1),
    left(nullif(trim(p ->> 'notes'), ''), 1000)
  )
  returning id into v_id;

  return jsonb_build_object('result', 'added', 'candidate_id', v_id);
end;
$$;

-- Marks songs as looked at, so the next run moves on to others.
create or replace function public.rpc_mark_checked(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  update tracks set routine_checked_at = now()
  where id in (
    select x from jsonb_array_elements_text(coalesce(p -> 'track_ids', '[]'::jsonb)) x limit 100
  );
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'marked', n);
end;
$$;

-- Corrections can carry a status (from a link suggestion); apply it on approval.
-- (New tracks were already handled; the review page passes corrections'
-- status through admin_set_release_status so per-field exclusions apply.)

-- 3. One-tap approve ------------------------------------------------------------

create or replace function public.approve_discovery(p_discovery_id uuid, p_note text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub uuid;
  s submissions%rowtype;
  v_track text;
  v_owner text;
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  v_sub := promote_discovery(p_discovery_id, p_note);
  select * into s from submissions where id = v_sub;

  if s.type = 'status_change' then
    v_track := approve_status_change(v_sub, p_note);
  else
    v_track := approve_submission(v_sub, '{}', p_note);
  end if;

  -- Link featured artists, as the review page does after approval.
  if s.type in ('new_track', 'new_version') and v_track is not null then
    select artist_id into v_owner from tracks where id = v_track;
    insert into track_appearances (track_id, artist_id)
    select v_track, a
    from jsonb_array_elements_text(coalesce(s.payload -> 'featured_artist_ids', '[]'::jsonb)) a
    where exists (select 1 from artists where id = a) and a is distinct from v_owner
    on conflict (track_id, artist_id) do nothing;
  end if;

  return v_track;
end;
$$;

-- 4. Quick merge for identical copies -------------------------------------------

-- Same artist, same title (ignoring case and spacing), same status, and
-- nothing that would need a decision: no versions, collections, ratings,
-- comments or differing details. Only one copy may have a link.
create or replace function public.find_identical_duplicates(p_limit int default 200)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not is_admin() then raise exception 'not authorized'; end if;

  with t as (
    select tr.id, tr.artist_id, tr.title, lower(regexp_replace(trim(tr.title), '\s+', ' ', 'g')) as k,
           tr.spotify_url, tr.release_status,
           coalesce(tr.album, '') || '|' || coalesce(tr.release_date::text, '') || '|' ||
           coalesce(tr.producers, '') || '|' || coalesce(tr.genre, '') || '|' || coalesce(tr.notes, '') || '|' ||
           coalesce(tr.track_number::text, '') as details
    from tracks tr
    where tr.parent_track_id is null
      and not exists (select 1 from tracks v where v.parent_track_id = tr.id)
      and not exists (select 1 from track_ownership o where o.track_id = tr.id)
      and not exists (select 1 from ratings r where r.track_id = tr.id)
      and not exists (select 1 from comments c where c.track_id = tr.id)
  ),
  g as (
    select t.artist_id, t.k, array_agg(t.id order by t.id) as ids, min(t.title) as title, count(*)::int as n
    from t
    where not sc_is_generic_title(sc_title_key(t.title))
    group by t.artist_id, t.k
    having count(*) > 1
       and count(distinct t.details) = 1
       and count(distinct t.release_status) = 1
       and count(t.spotify_url) <= 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'artist_id', g.artist_id, 'artist_name', ar.name, 'title', g.title, 'copies', g.n, 'track_ids', to_jsonb(g.ids)
  ) order by ar.name, g.title), '[]'::jsonb)
  into result
  from (select * from g order by artist_id, k limit greatest(1, least(coalesce(p_limit, 200), 2000))) g
  join artists ar on ar.id = g.artist_id;

  return result;
end;
$$;

-- Merge several groups at once. Keeps the copy with a link or the furthest
-- status (then the oldest id).
create or replace function public.admin_quick_merge(p_groups jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  grp jsonb;
  v_ids text[];
  v_keep text;
  total int := 0;
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  for grp in select * from jsonb_array_elements(coalesce(p_groups, '[]'::jsonb)) loop
    select array_agg(x) into v_ids from jsonb_array_elements_text(grp) x;
    continue when v_ids is null or array_length(v_ids, 1) < 2;
    select id into v_keep from tracks where id = any (v_ids)
    order by (spotify_url is null), release_status_rank(release_status) desc, id
    limit 1;
    continue when v_keep is null;
    total := total + admin_merge_duplicates(v_keep, array_remove(v_ids, v_keep));
  end loop;
  return total;
end;
$$;

-- 6. Genre tags: the admin isn't limited to 3 per artist -------------------------

create or replace function public.add_or_vote_genre_tag(p_artist_id text, p_tag text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tag_id uuid;
  v_user_id uuid;
  v_existing_count integer;
  v_clean_tag text;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'must be logged in';
  end if;

  v_clean_tag := trim(p_tag);
  if v_clean_tag = '' then
    raise exception 'tag cannot be empty';
  end if;

  select id into v_tag_id from artist_genre_tags
  where artist_id = p_artist_id and lower(tag) = lower(v_clean_tag);

  if v_tag_id is null then
    select count(*) into v_existing_count from artist_genre_tags
    where artist_id = p_artist_id and created_by = v_user_id;

    if v_existing_count >= 3 and not is_admin() then
      raise exception 'You can suggest at most 3 genre tags per artist';
    end if;

    insert into artist_genre_tags (artist_id, tag, created_by)
    values (p_artist_id, v_clean_tag, v_user_id)
    returning id into v_tag_id;
  end if;

  insert into artist_genre_tag_votes (tag_id, user_id) values (v_tag_id, v_user_id)
  on conflict (tag_id, user_id) do nothing;

  return v_tag_id;
end;
$$;

-- 7. Security and speed tidy-up ---------------------------------------------------

-- Every function gets a fixed search_path.
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and (p.proconfig is null or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))
  loop
    execute format('alter function %s set search_path = public', f.sig);
  end loop;
end;
$$;

-- Logged-out visitors can't call the privileged (security definer) functions
-- directly; the site only reads tables and views when logged out. Trigger
-- functions aren't callable by anyone; the triggers still run. Plain helper
-- functions (is_admin and friends) stay callable, since table policies use them.
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig, p.prorettype = 'trigger'::regtype as is_trigger
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and (p.prosecdef or p.prorettype = 'trigger'::regtype)
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    if f.is_trigger then
      execute format('revoke execute on function %s from authenticated', f.sig);
    else
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end;
$$;

-- Internal helpers don't need to be callable from the site at all.
revoke execute on function public.handle_new_user() from authenticated;
revoke execute on function public.sc_add_link_candidate(text, text) from authenticated;

-- Duplicate indexes.
drop index if exists public.comments_track_idx;
drop index if exists public.track_ownership_user_idx;
drop index if exists public.tracks_parent_idx;

-- Indexes the new queries use.
create index if not exists tracks_routine_checked_idx on public.tracks (artist_id, routine_checked_at);
create index if not exists track_link_candidates_track_idx on public.track_link_candidates (track_id);
create index if not exists track_appearances_artist_idx on public.track_appearances (artist_id);

commit;
