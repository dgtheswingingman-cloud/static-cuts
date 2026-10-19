-- Tracker statuses for songs already on the site (run after
-- 20261020100000_wrap_up_pack.sql).
--
-- Until now a community tracker row that matched a song we already had was
-- simply skipped, so whatever the tracker said about it (leaked, snippet,
-- released, leak date...) was thrown away. Now, for each matching song:
--   * our status is "unconfirmed" and the tracker gives a real one -> use
--     the tracker's, noting the tracker as the source (undo history batch)
--   * both have a real status and they differ -> "Tracker disagrees" list in
--     Moderation, unless ours is a Spotify-confirmed release (never
--     downgraded by a spreadsheet)
--   * empty details (leak date, era/album, release date, notes, producers,
--     features) are filled from the tracker; filled ones are never changed
-- The hourly tracker re-check keeps doing this, so statuses follow the
-- tracker as it's updated.

-- Where a song's status came from, for song pages ("status from: City
-- Morgue Tracker").
alter table tracks add column if not exists status_source text;
alter table tracks add column if not exists status_source_url text;
alter table track_status_events add column if not exists source_note text;

create or replace function tracks_log_status_event()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if coalesce(current_setting('static_cuts.skip_status_log', true), '') = 'on' then
    return new;
  end if;
  if new.release_status is distinct from old.release_status then
    insert into track_status_events (track_id, from_status, to_status, source_submission_id, created_by, source_note)
    values (
      new.id, old.release_status, new.release_status,
      nullif(current_setting('static_cuts.submission_id', true), '')::uuid,
      auth.uid(),
      nullif(current_setting('static_cuts.status_note', true), '')
    );
  end if;
  return new;
end;
$$;

create table if not exists tracker_disagreements (
  id uuid primary key default gen_random_uuid(),
  track_id text not null references tracks(id) on delete cascade,
  source_id uuid not null references sheet_sources(id) on delete cascade,
  current_status text not null,
  tracker_status text not null,
  tracker_title text,
  state text not null default 'open' check (state in ('open', 'applied', 'kept')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid,
  unique (track_id, source_id, tracker_status)
);
create index if not exists tracker_disagreements_open on tracker_disagreements (state) where state = 'open';
alter table tracker_disagreements enable row level security;
revoke all on tracker_disagreements from anon, authenticated;

-- Compare one artist's tracker rows with the songs already on their page.
-- p_items are the same rows sc_import_suggest gets ({title, status_guess,
-- album, release_date, extra: {leak_date, notes, producers, featuring}}).
create or replace function sc_sheet_reconcile(p_source uuid, p_home text, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  src sheet_sources%rowtype;
  it jsonb;
  v_ids text[];
  v_key text;
  t tracks%rowtype;
  v_status text;
  v_leak date;
  v_rel date;
  v_batch boolean := false;
  v_statuses int := 0;
  v_filled int := 0;
  v_disagree int := 0;
  v_same int := 0;
  v_n int;
begin
  select * into src from sheet_sources where id = p_source;
  if src.id is null then raise exception 'unknown sheet'; end if;

  perform set_config('static_cuts.credit_user', '', true);
  perform set_config('static_cuts.status_note', 'From ' || coalesce(src.title, 'a community tracker'), true);

  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    -- The song this row is about: same tidied title on this artist's page,
    -- preferring a main song when a version shares the name.
    -- (The key is worked out once here: inside the query it was re-worked
    -- for every song on the page, which timed out on big trackers.)
    v_key := sc_title_key(it ->> 'title');
    continue when v_key is null or v_key = '';
    select array_agg(tk.track_id order by tk.is_main desc) into v_ids
    from track_title_keys tk
    where tk.artist_id = p_home and tk.key = v_key;
    continue when v_ids is null;
    -- Two main songs with the same name: too unsure to touch either.
    continue when cardinality(v_ids) > 1
      and (select count(*) from track_title_keys where track_id = any (v_ids) and is_main) > 1;
    select * into t from tracks where id = v_ids[1];
    continue when t.id is null;

    v_status := it ->> 'status_guess';
    if v_status not in ('rumored', 'teased', 'snippet', 'leaked', 'announced', 'released') then v_status := null; end if;
    v_leak := nullif(it -> 'extra' ->> 'leak_date', '')::date;
    v_rel := nullif(it ->> 'release_date', '')::date;

    -- One undo-history batch per run, started only once something changes.
    if not v_batch and (
         (v_status is not null and coalesce(t.release_status, 'unconfirmed') = 'unconfirmed')
      or (v_status is not null and t.release_status = v_status and t.status_source is null)
      or (t.leak_date is null and v_leak is not null)
      or (t.album is null and nullif(it ->> 'album', '') is not null)
      or (t.notes is null and nullif(it -> 'extra' ->> 'notes', '') is not null)
      or (t.producers is null and nullif(it -> 'extra' ->> 'producers', '') is not null)
      or (t.featured_artists is null and nullif(it -> 'extra' ->> 'featuring', '') is not null)) then
      perform sc_begin_batch('tracker', 'Tracker update: ' || coalesce(src.title, 'community tracker'));
      v_batch := true;
    end if;

    -- Status.
    if v_status is not null then
      if coalesce(t.release_status, 'unconfirmed') = 'unconfirmed' then
        update tracks set release_status = v_status, status_source = src.title, status_source_url = src.url
        where id = t.id;
        v_statuses := v_statuses + 1;
      elsif t.release_status = v_status then
        v_same := v_same + 1;
        if t.status_source is null then
          update tracks set status_source = src.title, status_source_url = src.url where id = t.id;
        end if;
      elsif t.release_status = 'released' and coalesce(t.spotify_url, '') like '%open.spotify.com%' then
        null; -- Spotify says it's out; a spreadsheet doesn't overrule that.
      else
        insert into tracker_disagreements (track_id, source_id, current_status, tracker_status, tracker_title)
        values (t.id, src.id, t.release_status, v_status, it ->> 'title')
        on conflict (track_id, source_id, tracker_status) do nothing;
        get diagnostics v_n = row_count;
        v_disagree := v_disagree + v_n;
      end if;
    end if;

    -- Empty details only.
    update tracks set
      leak_date = coalesce(leak_date, v_leak),
      album = coalesce(album, nullif(it ->> 'album', '')),
      release_date = coalesce(release_date, case when coalesce(v_status, release_status) = 'released' then v_rel end),
      notes = coalesce(notes, nullif(it -> 'extra' ->> 'notes', '')),
      producers = coalesce(producers, nullif(it -> 'extra' ->> 'producers', '')),
      featured_artists = coalesce(featured_artists, nullif(it -> 'extra' ->> 'featuring', ''))
    where id = t.id
      and ((leak_date is null and v_leak is not null)
        or (album is null and nullif(it ->> 'album', '') is not null)
        or (release_date is null and v_rel is not null and coalesce(v_status, release_status) = 'released')
        or (notes is null and nullif(it -> 'extra' ->> 'notes', '') is not null)
        or (producers is null and nullif(it -> 'extra' ->> 'producers', '') is not null)
        or (featured_artists is null and nullif(it -> 'extra' ->> 'featuring', '') is not null));
    get diagnostics v_n = row_count;
    v_filled := v_filled + v_n;
  end loop;

  perform set_config('static_cuts.status_note', '', true);
  return jsonb_build_object('statuses', v_statuses, 'details', v_filled, 'disagree', v_disagree, 'agreed', v_same);
end;
$$;
revoke execute on function sc_sheet_reconcile(uuid, text, jsonb) from public, anon, authenticated;

-- The tracker import: same as before, plus the comparison above for every
-- artist the sheet covers.
create or replace function sc_sheet_import(p_user uuid, p_source uuid, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  src sheet_sources%rowtype;
  it jsonb;
  v_home text;
  v_named text;
  v_runs jsonb := '{}'::jsonb;
  v_run uuid;
  v_res jsonb;
  v_rec jsonb;
  v_suggested int := 0;
  v_skipped int := 0;
  v_statuses int := 0;
  v_details int := 0;
  v_disagree int := 0;
  v_other text;
  v_note text;
  v_names text[];
  g record;
begin
  select * into src from sheet_sources where id = p_source;
  if src.id is null then raise exception 'unknown sheet'; end if;
  if not sc_user_can_moderate(p_user) then raise exception 'Only moderators can import sheets.'; end if;

  create temp table if not exists _sc_sheet_items (home text, item jsonb) on commit drop;
  truncate _sc_sheet_items;

  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    continue when coalesce(trim(it ->> 'title'), '') = '';
    select coalesce(array_agg(x order by n), '{}') into v_names
    from jsonb_array_elements_text(coalesce(it -> 'artists', '[]'::jsonb)) with ordinality a(x, n)
    where trim(x) <> '';
    -- Home: the first name before the dash that's an artist here, else the
    -- sheet's artist.
    v_home := null;
    foreach v_named in array v_names loop
      v_home := sc_find_artist(v_named);
      exit when v_home is not null;
    end loop;
    v_note := it ->> 'notes';
    v_other := null;
    if v_home is null and cardinality(v_names) > 0
       and lower(v_names[1]) <> lower((select name from artists where id = src.artist_id)) then
      -- Credited to someone without a page here (e.g. a side project).
      v_note := concat_ws(E'\n', 'Credited to ' || array_to_string(v_names, ' & ') || '.', v_note);
    else
      -- Everyone else named before the dash counts as featured.
      select string_agg(x, ', ') into v_other from unnest(v_names) x
      where sc_find_artist(x) is distinct from coalesce(v_home, src.artist_id)
        and lower(x) <> lower((select name from artists where id = coalesce(v_home, src.artist_id)));
    end if;
    v_home := coalesce(v_home, src.artist_id);
    insert into _sc_sheet_items values (v_home, jsonb_build_object(
      'title', trim(it ->> 'title'),
      'status_guess', it ->> 'status',
      'url', src.url,
      'album', nullif(trim(it ->> 'album'), ''),
      'release_date', nullif(it ->> 'release_date', ''),
      'extra', jsonb_strip_nulls(jsonb_build_object(
        'featuring', nullif(concat_ws(', ', nullif(v_other, ''), nullif(it ->> 'featuring', '')), ''),
        'producers', nullif(it ->> 'producers', ''),
        'notes', nullif(v_note, ''),
        'listen_url', nullif(it ->> 'listen_url', ''), 'leak_date', nullif(it ->> 'leak_date', ''),
        'sheet_source', src.id))));
  end loop;

  for g in select home, jsonb_agg(item) items from _sc_sheet_items group by home loop
    -- Songs we already have: take the tracker's status and fill gaps.
    v_rec := sc_sheet_reconcile(src.id, g.home, g.items);
    v_statuses := v_statuses + (v_rec ->> 'statuses')::int;
    v_details := v_details + (v_rec ->> 'details')::int;
    v_disagree := v_disagree + (v_rec ->> 'disagree')::int;
    -- Songs we don't: the imported songs list, as before.
    insert into import_runs (artist_id, source, requested_by) values (g.home, 'sheet', p_user) returning id into v_run;
    v_res := sc_import_suggest(v_run, g.items);
    update import_runs set finished_at = now() where id = v_run;
    v_suggested := v_suggested + (v_res ->> 'suggested')::int;
    v_skipped := v_skipped + (v_res ->> 'skipped')::int;
    v_runs := v_runs || jsonb_build_object(g.home, v_res || v_rec);
  end loop;

  v_res := jsonb_build_object('suggested', v_suggested, 'skipped', v_skipped, 'statuses', v_statuses,
                              'details', v_details, 'disagree', v_disagree, 'artists', v_runs, 'at', now());
  update sheet_sources set last_synced_at = now(), last_result = v_res where id = src.id;
  update sheet_requests set state = 'imported', source_id = src.id, handled_at = now()
  where sheet_id = src.sheet_id and (gid is null or gid = src.gid) and state = 'open';
  return v_res;
end;
$$;

-- Moderation: the "Tracker disagrees" list.
create or replace function admin_tracker_disagreements()
returns table (id uuid, track_id text, title text, artist_id text, artist text, current_status text,
               tracker_status text, tracker_title text, source_title text, source_url text, spotify_url text,
               created_at timestamptz)
language sql
stable
security definer
set search_path to 'public'
as $$
  select d.id, t.id, t.title, t.artist_id, a.name, t.release_status, d.tracker_status, d.tracker_title,
         s.title, s.url, t.spotify_url, d.created_at
  from tracker_disagreements d
  join tracks t on t.id = d.track_id
  join artists a on a.id = t.artist_id
  join sheet_sources s on s.id = d.source_id
  where d.state = 'open' and is_moderator()
  order by a.name, t.title;
$$;
revoke execute on function admin_tracker_disagreements() from public, anon;
grant execute on function admin_tracker_disagreements() to authenticated;

-- Use the tracker's status, or keep ours (and stop asking).
create or replace function admin_decide_tracker_disagreements(p_ids uuid[], p_use_tracker boolean)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  d record;
  n int := 0;
begin
  if not is_moderator() then raise exception 'not authorized'; end if;
  if p_use_tracker then
    perform sc_begin_batch('tracker', 'Tracker disagreements: used the tracker''s status');
  end if;
  for d in select x.*, s.title source_title, s.url source_url
           from tracker_disagreements x join sheet_sources s on s.id = x.source_id
           where x.id = any (p_ids[1:500]) and x.state = 'open' loop
    if p_use_tracker then
      perform set_config('static_cuts.status_note', 'From ' || coalesce(d.source_title, 'a community tracker'), true);
      update tracks set release_status = d.tracker_status, status_source = d.source_title, status_source_url = d.source_url
      where id = d.track_id;
    end if;
    update tracker_disagreements set state = case when p_use_tracker then 'applied' else 'kept' end,
      decided_at = now(), decided_by = auth.uid()
    where id = d.id;
    n := n + 1;
  end loop;
  perform set_config('static_cuts.status_note', '', true);
  return n;
end;
$$;
revoke execute on function admin_decide_tracker_disagreements(uuid[], boolean) from public, anon;
grant execute on function admin_decide_tracker_disagreements(uuid[], boolean) to authenticated;

create or replace function rpc_moderation_counts()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select case when is_moderator() then jsonb_build_object(
    'suggestions', (select count(*) from submissions where status = 'pending'),
    'finds', (select count(*) from discoveries where state = 'open'),
    'sub_versions', (select count(*) from version_suggestions where state = 'open'),
    'imported_songs', (select count(*) from import_suggestions where state = 'open'),
    'guest_artists', (select count(*) from guest_artists where state = 'review' and songs > 0),
    'reported_comments', (select count(distinct c.id) from comments c join comment_reports r on r.comment_id = c.id
                          where c.reviewed_at is null or r.created_at > c.reviewed_at),
    'sheet_requests', (select count(*) from sheet_requests where handled_at is null),
    'tracker_disagreements', (select count(*) from tracker_disagreements where state = 'open'),
    'takedowns', case when is_admin() then (select count(*) from takedown_requests where state = 'open') end
  ) end;
$$;

-- Song pages: where the status came from, and notes on the status history.
create or replace function rpc_song_page(p_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  t tracks%rowtype;
  v_id text := p_id;
  v_main text;
  v_me uuid := auth.uid();
  v_my int;
  i int := 0;
begin
  select * into t from tracks where id = v_id;
  -- Follow merges (a chain of at most 5).
  while t.id is null and i < 5 loop
    select new_track_id into v_id from track_redirects where old_track_id = v_id;
    exit when v_id is null;
    select * into t from tracks where id = v_id;
    i := i + 1;
  end loop;
  if t.id is null then return null; end if;
  if t.id <> p_id then return jsonb_build_object('redirect', t.id); end if;

  v_main := coalesce(t.parent_track_id, t.id);
  if v_me is not null then
    select value into v_my from ratings where user_id = v_me and track_id = t.id;
  end if;

  return jsonb_build_object(
    'track', jsonb_build_object(
      'id', t.id, 'title', t.title, 'artist_id', t.artist_id, 'spotify_url', t.spotify_url,
      'parent_track_id', t.parent_track_id, 'is_featured', t.is_featured, 'is_official', t.is_official,
      'has_audio', t.has_audio, 'aliases', t.aliases, 'track_number', t.track_number,
      'release_date', t.release_date, 'cover_url', t.cover_url, 'leak_date', t.leak_date, 'producers', t.producers, 'featured_artists', t.featured_artists,
      'genre', t.genre, 'notes', t.notes, 'album', t.album, 'release_status', t.release_status,
      'created_at', t.created_at, 'source', t.source, 'source_url', t.source_url,
      'status_source', t.status_source, 'status_source_url', t.status_source_url,
      'spotify_verified_at', t.spotify_link_verified_at),
    'artist', (select jsonb_build_object('id', a.id, 'name', a.name) from artists a where a.id = t.artist_id),
    -- The main song and all its versions, main first.
    'family', (select coalesce(jsonb_agg(jsonb_build_object(
                 'id', f.id, 'title', f.title, 'release_status', f.release_status,
                 'is_official', f.is_official, 'spotify_url', f.spotify_url, 'is_main', f.id = v_main)
                 order by (f.id = v_main) desc, f.release_date nulls last, f.title), '[]'::jsonb)
               from tracks f where f.id = v_main or f.parent_track_id = v_main),
    'appears_on', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name) order by a.name), '[]'::jsonb)
                   from track_appearances ap join artists a on a.id = ap.artist_id
                   where ap.track_id = t.id and ap.artist_id <> t.artist_id),
    'history', (select coalesce(jsonb_agg(jsonb_build_object('from', e.from_status, 'to', e.to_status, 'at', e.created_at,
                                                             'note', e.source_note,
                                                             'by_suggestion', e.source_submission_id is not null)
                  order by e.created_at), '[]'::jsonb)
                from track_status_events e where e.track_id = t.id),
    'added_by', (select jsonb_build_object('id', p.id, 'name', coalesce(p.display_name, 'someone'))
                 from profiles p where p.id = t.added_by and sc_contributions_visible(t.added_by)),
    'collectors', (select count(*) from track_ownership where track_id = t.id),
    'comments', (select count(*) from comments where track_id = t.id),
    'owned', v_me is not null and exists (select 1 from track_ownership where user_id = v_me and track_id = t.id),
    'my_rating', v_my,
    'rating', case when v_my is null then
                (select jsonb_build_object('count', rating_count) from track_rating_stats where track_id = t.id)
              else
                (select jsonb_build_object('avg', round(avg_rating, 1), 'count', rating_count)
                 from track_rating_stats where track_id = t.id) end
  );
end;
$$;

-- Re-check every tracker on the next timer runs, so existing songs pick up
-- their statuses straight away.
update sheet_sources set next_check_at = now(), last_synced_at = null where auto_sync;

select 'done' as result, (select count(*) from sheet_sources where auto_sync) as trackers_to_recheck;
