-- ChatGPT routines: don't redo other users' work.
--
-- The research plan now tells ChatGPT, per artist:
--   search_since      only look for news after this date (shared across all
--                     users: whoever checked the artist last). Null = never
--                     checked, do a full sweep.
--   recently_added    songs added or whose status changed in the last 60 days
--                     (already known, skip without checking)
--   already_handled   finds from the last 90 days that were already approved
--                     or dismissed (skip, don't research again)
--   open_discoveries  finds waiting in review (as before)
--
-- check_candidate gets a new verdict, previously_dismissed, and there's a
-- batch version (check_candidates) that checks up to 50 titles in one call.
-- New songs now record when they were added (tracks.created_at).

alter table tracks add column if not exists created_at timestamptz;
alter table tracks alter column created_at set default now();
create index if not exists tracks_created_at_idx on tracks (artist_id, created_at) where created_at is not null;
create index if not exists track_status_events_track_created_idx on track_status_events (track_id, created_at);
create index if not exists discoveries_artist_state_idx on discoveries (artist_id, state, reviewed_at);
create index if not exists discoveries_main_artist_state_idx on discoveries (main_artist_id, state, reviewed_at) where main_artist_id is not null;

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

  select coalesce(jsonb_agg(x order by x->>'_sort'), '[]'::jsonb) into result
  from (
    select jsonb_build_object(
      '_sort', coalesce(to_char(rs.last_researched_at, 'YYYY-MM-DD"T"HH24:MI:SS'), '0000'),
      'artist_id', ar.id,
      'name', ar.name,
      'last_researched_at', rs.last_researched_at,
      'researched_recently', coalesce(rs.last_researched_at > now() - interval '12 hours', false),
      -- Two days of overlap so nothing slips between runs.
      'search_since', to_char((rs.last_researched_at - interval '2 days') at time zone 'UTC', 'YYYY-MM-DD'),
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
    left join artist_research_state rs on rs.artist_id = ar.id
    where f.user_id = uid
    order by rs.last_researched_at nulls first
    limit greatest(1, least(coalesce(p_limit, 15), 50))
  ) s;

  return jsonb_build_object(
    'artists', (select coalesce(jsonb_agg(e - '_sort'), '[]'::jsonb) from jsonb_array_elements(result) e),
    'note', 'Shared across everyone using Static Cuts, so don''t redo work. For each artist: only look for news '
      || 'dated on or after search_since (null means never checked: do a full sweep). Skip anything in '
      || 'recently_added, already_handled or open_discoveries without checking it. If researched_recently is true, '
      || 'skip the artist unless you have time left. Check the rest with check_candidates (up to 50 titles in one '
      || 'call) before submitting. needs_status lists songs whose status is unknown: find out whether each is '
      || 'released, leaked, a snippet etc., submit what you can prove, then call mark_checked with the track_ids.'
  );
end;
$$;

-- Single check, now also reporting finds that were already dismissed.
create or replace function public.rpc_check_candidate(p_artist_id text, p_title text, p_observed_status text default null, p_main_artist_name text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
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
  v_dismissed boolean := false;
  verdict text;
  v_disc_title text;
  v_disc_ver text;
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

  v_disc_title := case when v_parent_id is not null then v_base else p_title end;
  v_disc_ver := case when v_parent_id is not null then sc_normalize_title(v_ver) else '' end;

  select id, to_status, development_type, corroboration_count into open_disc
  from discoveries
  where artist_id in (p_artist_id, coalesce(v_main, p_artist_id)) and state = 'open'
    and sc_normalize_title(title) = sc_normalize_title(v_disc_title)
    and coalesce(sc_normalize_title(version_hint), '') = v_disc_ver
  order by last_seen_at desc
  limit 1;

  if best.track_id is null and open_disc.id is null then
    select true into v_dismissed
    from discoveries
    where artist_id in (p_artist_id, coalesce(v_main, p_artist_id)) and state in ('dismissed', 'stale')
      and coalesce(reviewed_at, last_seen_at) > now() - interval '90 days'
      and sc_normalize_title(title) = sc_normalize_title(v_disc_title)
      and coalesce(sc_normalize_title(version_hint), '') = v_disc_ver
      and (p_observed_status is null or to_status is null or to_status = p_observed_status)
    limit 1;
  end if;

  if best.track_id is null then
    verdict := case when open_disc.id is not null then 'open_discovery'
                    when coalesce(v_dismissed, false) then 'previously_dismissed'
                    else 'new' end;
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

-- Batch check: up to 50 titles for one artist in one call. Returns a compact
-- result per title, in the same order.
create or replace function public.rpc_check_candidates(p jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_artist text := p ->> 'artist_id';
  item jsonb;
  r jsonb;
  v_out jsonb := '[]'::jsonb;
  n int := 0;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  for item in select * from jsonb_array_elements(coalesce(p -> 'items', '[]'::jsonb)) loop
    n := n + 1;
    exit when n > 50;
    continue when nullif(trim(item ->> 'title'), '') is null;
    r := rpc_check_candidate(
      coalesce(item ->> 'artist_id', v_artist),
      item ->> 'title',
      nullif(item ->> 'observed_status', ''),
      nullif(item ->> 'main_artist_name', ''));
    v_out := v_out || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'title', item ->> 'title',
      'verdict', r ->> 'verdict',
      'current_status', r -> 'matches' -> 0 ->> 'status',
      'track_id', r -> 'matches' -> 0 ->> 'track_id',
      'version_of', r -> 'version_of',
      'main_artist', r -> 'main_artist',
      'open_discovery', r -> 'open_discovery')));
  end loop;
  return jsonb_build_object('results', v_out, 'checked', jsonb_array_length(v_out),
    'note', case when n > 50 then 'Only the first 50 titles were checked; send the rest in another call.' end);
end;
$$;

revoke execute on function rpc_check_candidates(jsonb) from public, anon;
grant execute on function rpc_check_candidates(jsonb) to authenticated;
