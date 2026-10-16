-- Release status fixes
--
-- 1. Archival releases and reissues with official evidence count as
--    released (they were being saved as leaked).
-- 2. Discoveries with no explicit status are released when there's official
--    evidence, otherwise leaked.
-- 3. Corrects songs already approved from such discoveries, and open
--    discoveries waiting for review.
--
-- Run in the Supabase SQL Editor. Wrapped in a transaction.

begin;

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
  v_status := coalesce(d.to_status,
    case when d.official_status = 'official' or coalesce(ev.spotify, ev.official_any) is not null
         then 'released' else 'leaked' end);

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

-- Open discoveries filed before this fix.
update discoveries d set to_status = 'released'
where d.state = 'open' and d.to_status is null
  and d.development_type in ('ARCHIVAL', 'REISSUE')
  and (d.official_status = 'official'
       or exists (select 1 from discovery_evidence e where e.discovery_id = d.id
                  and coalesce(e.spotify_url, e.official_listening_url) is not null));

-- Songs already approved from such discoveries.
update tracks t set release_status = 'released'
from submissions s
left join track_redirects r on r.old_track_id = s.resulting_id
join discoveries d on d.id = (s.payload ->> 'discovery_id')::uuid
where s.status = 'approved'
  and s.payload ? 'discovery_id'
  and t.id = coalesce(r.new_track_id, s.resulting_id)
  and d.to_status is null
  and t.release_status <> 'released'
  and (d.official_status = 'official'
       or exists (select 1 from discovery_evidence e where e.discovery_id = d.id
                  and coalesce(e.spotify_url, e.official_listening_url) is not null));

commit;
