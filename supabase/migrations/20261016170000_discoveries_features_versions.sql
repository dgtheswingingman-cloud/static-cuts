-- ChatGPT discoveries: features and versions
--
-- 1. Allows the status_change submission type (same as
--    20261016160000_allow_status_change_submissions.sql; safe to run twice).
-- 2. A followed artist FEATURED on someone else's song is filed under the main
--    artist, with the followed artist linked as a feature (main_artist_id).
-- 3. Other artists featured on a song are resolved to real artist ids and
--    linked on approval (featured_artist_ids), like the normal submit form.
-- 4. A version of a known song (Demo, V2, Remix, Live...) is attached under the
--    original as a sub-version (parent_track_id) instead of a separate song.
--
-- Run in the Supabase SQL Editor. Wrapped in a transaction.

begin;

-- 1 -------------------------------------------------------------------------
alter table public.submissions drop constraint if exists submissions_type_check;
alter table public.submissions add constraint submissions_type_check
  check (type = any (array['new_artist', 'new_track', 'new_version', 'correction', 'flag_link', 'flag_deletion', 'status_change']));

-- New discovery columns -----------------------------------------------------
alter table public.discoveries
  add column if not exists main_artist_id text references public.artists(id) on delete set null,
  add column if not exists main_artist_name text,
  add column if not exists featured_artist_ids text[] not null default '{}',
  add column if not exists parent_track_id text references public.tracks(id) on delete set null;

-- Helpers -------------------------------------------------------------------

-- Artist id by name (case, punctuation and spacing ignored), or null.
create or replace function public.sc_find_artist(p_name text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select id from artists
  where sc_normalize_title(p_name) <> ''
    and sc_normalize_title(name) = sc_normalize_title(p_name)
  order by id
  limit 1
$$;

-- "Song (Demo)" -> base "Song", version "Demo". Ignores (feat. ...) groups.
-- Returns nulls when there's no trailing bracket group.
create or replace function public.sc_split_version(p_title text, out base text, out version text)
language plpgsql
immutable
as $$
declare
  cleaned text;
  m text[];
begin
  cleaned := regexp_replace(coalesce(p_title, ''),
    '\s*[\(\[]\s*(feat\.?|ft\.?|featuring|with|prod\.?|produced by)\s[^\)\]]*[\)\]]', '', 'gi');
  m := regexp_match(cleaned, '^(.*\S)\s*[\(\[]([^\(\)\[\]]+)[\)\]]\s*$');
  if m is not null then
    base := trim(m[1]);
    version := trim(m[2]);
  end if;
end;
$$;

-- Featured artist names ("A, B & C") -> artist ids found in the archive.
create or replace function public.sc_resolve_artists(p_names text, p_exclude text[] default '{}')
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct a), '{}')
  from (
    select sc_find_artist(n) as a
    from regexp_split_to_table(coalesce(p_names, ''), '\s*[,;&]\s*') n
    where trim(n) <> ''
  ) x
  where a is not null and not (a = any (coalesce(p_exclude, '{}')))
$$;

-- check_candidate: also looks under the main artist and suggests a parent --
drop function if exists public.rpc_check_candidate(text, text, text);

create or replace function public.rpc_check_candidate(
  p_artist_id text,
  p_title text,
  p_observed_status text default null,
  p_main_artist_name text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_main text;
  matches jsonb;
  best record;
  v_base text;
  v_ver text;
  v_parent_id text;
  v_parent_title text;
  open_disc record;
  verdict text;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  if not exists (select 1 from artists where id = p_artist_id) then
    raise exception 'unknown artist_id %', p_artist_id;
  end if;

  if p_main_artist_name is not null then
    v_main := sc_find_artist(p_main_artist_name);
    if v_main = p_artist_id then v_main := null; end if;
  end if;

  select coalesce(jsonb_agg(distinct jsonb_build_object(
    'track_id', m.track_id, 'title', m.title, 'status', m.release_status, 'is_version', m.is_version)), '[]'::jsonb)
  into matches
  from (
    select * from sc_match_tracks(p_artist_id, p_title)
    union all
    select * from sc_match_tracks(v_main, p_title) where v_main is not null
  ) m;

  select * into best from sc_match_tracks(p_artist_id, p_title) limit 1;
  if best.track_id is null and v_main is not null then
    select * into best from sc_match_tracks(v_main, p_title) limit 1;
  end if;

  if best.track_id is null then
    select s.base, s.version into v_base, v_ver from sc_split_version(p_title) s;
    if v_base is not null then
      select m.track_id, m.title into v_parent_id, v_parent_title
      from sc_match_tracks(coalesce(v_main, p_artist_id), v_base) m where not m.is_version limit 1;
      if v_parent_id is null and v_main is not null then
        select m.track_id, m.title into v_parent_id, v_parent_title
        from sc_match_tracks(p_artist_id, v_base) m where not m.is_version limit 1;
      end if;
    end if;
  end if;

  select id, to_status, development_type, corroboration_count into open_disc
  from discoveries
  where artist_id in (p_artist_id, coalesce(v_main, p_artist_id)) and state = 'open'
    and sc_normalize_title(title) = sc_normalize_title(case when v_parent_id is not null then v_base else p_title end)
    and coalesce(sc_normalize_title(version_hint), '') = case when v_parent_id is not null then sc_normalize_title(v_ver) else '' end
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
    'main_artist', case when p_main_artist_name is null then null
                        else jsonb_build_object('name', p_main_artist_name, 'artist_id', v_main, 'in_archive', v_main is not null) end,
    'version_of', case when v_parent_id is null then null
                       else jsonb_build_object('track_id', v_parent_id, 'title', v_parent_title, 'version', v_ver) end,
    'open_discovery', case when open_disc.id is null then null else jsonb_build_object(
      'id', open_disc.id, 'to_status', open_disc.to_status,
      'type', open_disc.development_type, 'corroborations', open_disc.corroboration_count) end
  );
end;
$$;

-- submit_discovery: features, featured artists, versions ------------------
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
  v_main_name text := nullif(trim(p ->> 'main_artist_name'), '');
  v_main text;
  v_home text;
  v_to text;
  v_match record;
  v_parent_id text;
  v_base text;
  v_ver text;
  v_feat_ids text[];
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
  if v_type = 'PRE_SAVE' then v_type := 'PRESAVE'; end if;
  if v_type = 'LEAK' then v_type := 'LEAKED'; end if;
  if v_type = 'RELEASE' then v_type := 'RELEASED'; end if;

  select count(*) into v_today_count
  from discovery_evidence where user_id = uid and created_at > now() - interval '1 day';
  if v_today_count >= 100 then raise exception 'daily limit reached (100 findings per day)'; end if;

  -- Whose song is it? A followed artist featured on someone else's song is
  -- filed under that main artist.
  if v_main_name is not null then
    v_main := sc_find_artist(v_main_name);
    if v_main = v_artist then
      v_main := null;
      v_main_name := null;
    end if;
  end if;
  v_home := coalesce(v_main, v_artist);

  v_to := sc_dev_type_status(v_type);

  -- Exact match first (title + version), under either artist.
  select * into v_match
  from sc_match_tracks(v_artist, v_title || coalesce(' (' || v_version || ')', '')) limit 1;
  if v_match.track_id is null and v_main is not null then
    select * into v_match
    from sc_match_tracks(v_main, v_title || coalesce(' (' || v_version || ')', '')) limit 1;
  end if;

  -- No exact match: is it a version of a known song?
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

  -- Already in the catalogue at this status (or further along): nothing to do.
  if v_match.track_id is not null and v_to is not null and v_to <> 'removed'
     and (v_to = v_match.release_status
          or release_status_rank(v_to) < release_status_rank(v_match.release_status)) then
    return jsonb_build_object('result', 'already_known', 'track_id', v_match.track_id,
                              'current_status', v_match.release_status);
  end if;

  -- Other featured artists, as real artist ids (not the song's own artists).
  v_feat_ids := sc_resolve_artists(p ->> 'featured_artists',
                                   array_remove(array[v_home, case when v_main is not null then v_artist end], null));

  -- Keyed on the song's home artist, so a fan of the main artist and a fan of
  -- the featured artist reporting the same song land on one discovery.
  v_fp := v_home || '|' || sc_normalize_title(v_title) || '|' ||
          coalesce(sc_normalize_title(v_version), '') || '|' || coalesce(v_to, lower(v_type));

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
    main_artist_id = coalesce(discoveries.main_artist_id, excluded.main_artist_id),
    main_artist_name = coalesce(discoveries.main_artist_name, excluded.main_artist_name),
    parent_track_id = coalesce(discoveries.parent_track_id, excluded.parent_track_id),
    featured_artist_ids = array(select distinct unnest(discoveries.featured_artist_ids || excluded.featured_artist_ids)),
    featured_artists = coalesce(discoveries.featured_artists, excluded.featured_artists)
  returning id, (xmax = 0) into v_disc_id, v_inserted;

  insert into discovery_evidence (
    discovery_id, user_id, source_url, source_layer, official_listening_url,
    unofficial_listening_url, date_surfaced, notes
  ) values (
    v_disc_id, uid, v_source, nullif(lower(p ->> 'source_layer'), ''),
    nullif(p ->> 'official_listening_url', ''), nullif(p ->> 'unofficial_listening_url', ''),
    nullif(p ->> 'date_surfaced', '')::date, left(nullif(p ->> 'notes', ''), 2000)
  )
  on conflict (discovery_id, source_url) do nothing;
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

-- promote: route features, featured artists and versions ------------------
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

  select string_agg(distinct source_url, E'\n') as sources,
         max(official_listening_url) as official_url,
         max(unofficial_listening_url) as unofficial_url
  into ev from discovery_evidence where discovery_id = d.id;

  select name into v_followed_name from artists where id = d.artist_id;

  v_notes := concat_ws(E'\n',
    'Found by ChatGPT routine (' || d.development_type || ', ' || d.corroboration_count || ' contributor(s)).',
    case when d.main_artist_name is not null and d.main_artist_id is null then
      'Main artist "' || d.main_artist_name || '" is not in the archive yet, so this would land on '
      || coalesce(v_followed_name, d.artist_id) || '''s page. Add the artist first if you want it filed under them.' end,
    'Sources:', ev.sources,
    case when ev.unofficial_url is not null then 'Unofficial listen: ' || ev.unofficial_url end,
    p_note);

  v_status := coalesce(d.to_status, 'leaked');

  if d.matched_track_id is not null and d.to_status is not null then
    v_type := 'status_change';
    v_sub_artist := d.artist_id;
    v_payload := jsonb_build_object(
      'track_id', d.matched_track_id, 'from_status', d.from_status, 'to_status', d.to_status,
      'release_date', d.release_date, 'notes', v_notes, 'discovery_id', d.id);

  elsif d.matched_track_id is not null then
    v_type := 'correction';
    v_sub_artist := d.artist_id;
    v_payload := jsonb_strip_nulls(jsonb_build_object(
      'track_id', d.matched_track_id, 'release_date', d.release_date,
      'featured_artists', d.featured_artists, 'notes', v_notes, 'discovery_id', d.id));

  elsif d.parent_track_id is not null then
    -- A version of a known song: attach it under the original, on the
    -- original's artist page.
    v_type := 'new_version';
    select artist_id into v_sub_artist from tracks where id = d.parent_track_id;
    v_payload := jsonb_strip_nulls(jsonb_build_object(
      'title', d.title || coalesce(' (' || d.version_hint || ')', ''),
      'parent_track_id', d.parent_track_id,
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
    -- A new song. If the followed artist is the feature, approve_submission
    -- files it under main_artist_id and links the followed artist.
    v_type := 'new_track';
    v_sub_artist := d.artist_id;
    v_payload := jsonb_strip_nulls(jsonb_build_object(
      'title', d.title || coalesce(' (' || d.version_hint || ')', ''),
      'spotify_url', case when ev.official_url ilike '%open.spotify.com%' then ev.official_url end,
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

-- Permissions ---------------------------------------------------------------
revoke all on function public.sc_find_artist(text) from public, anon;
revoke all on function public.sc_resolve_artists(text, text[]) from public, anon;
revoke all on function public.rpc_check_candidate(text, text, text, text) from public, anon;
grant execute on function public.sc_find_artist(text) to authenticated;
grant execute on function public.sc_resolve_artists(text, text[]) to authenticated;
grant execute on function public.rpc_check_candidate(text, text, text, text) to authenticated;

commit;
