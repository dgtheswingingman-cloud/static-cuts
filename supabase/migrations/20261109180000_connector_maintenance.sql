-- ChatGPT connector: catalogue maintenance that doesn't depend on the
-- research queue (9 Nov 2026).
--
-- Bug: get_research_plan picked the user's follows out of the top 500 of the
-- WHOLE queue, due artists first. Once every followed artist was researched
-- recently they were pushed out by 500 never-checked artists and the plan
-- came back empty. sc_artist_queue now takes the artists to rank.
--
-- New, for the connector:
--   rpc_catalogue_backlog   songs needing a status, a link or details, across
--                           the user's followed artists (or one artist), with
--                           counts; independent of research cooldowns
--   rpc_artist_songs        an artist's whole catalogue, page by page
--   rpc_my_review_status    what happened to this user's finds/suggestions
-- Changed:
--   rpc_suggest_details     replace = true proposes corrections to filled
--                           fields (still reviewed; old values shown)
--   rpc_research_plan       always returns followed artists, plus backlog
--                           counts so an empty news queue isn't read as done

-- ---------- queue: rank only the given artists ----------
drop function if exists sc_artist_queue(integer, boolean);
create function sc_artist_queue(p_limit integer default 50, p_only_due boolean default true, p_artists text[] default null)
returns table(artist_id text, name text, score numeric, due boolean, next_due_at timestamptz, track_count bigint, followers bigint,
              requests bigint, last_checked_at timestamptz, quiet_streak integer, reasons text[])
language sql stable security definer set search_path to 'public' as $function$
  with base as (
    select a.id, a.name,
      coalesce(tc.n, 0)::bigint as n_tracks,
      coalesce(f.n, 0)::bigint as n_followers,
      coalesce(r.n, 0)::bigint as n_requests,
      rs.last_researched_at, rs.next_due_at, coalesce(rs.quiet_streak, 0) as streak, rs.last_found_at
    from artists a
    left join artist_track_counts tc on tc.artist_id = a.id
    left join (select f.artist_id, count(*) n from follows f group by 1) f on f.artist_id = a.id
    left join (select r.artist_id, count(*) n from artist_requests r where r.created_at > now() - interval '30 days' group by 1) r on r.artist_id = a.id
    left join artist_research_state rs on rs.artist_id = a.id
    where p_artists is null or a.id = any (p_artists)
  ),
  scored as (
    select b.*,
      (round(40 * ln(1 + b.n_followers)::numeric, 1)
       + least(b.n_requests, 10) * 20
       + (case when b.n_tracks = 0 then 40 when b.n_tracks <= 10 then 25 when b.n_tracks <= 50 then 8 else 0 end
          + case when b.last_researched_at is null then 15 else 0 end)
         * case when b.n_followers > 0 or b.n_requests > 0 then 1 else 0.25 end
       + case when b.last_found_at > now() - interval '14 days' then 25 else 0 end
       + least(greatest(extract(epoch from (now() - coalesce(b.next_due_at, now()))) / 86400.0, 0), 30)
      )::numeric as score,
      (b.next_due_at is null or b.next_due_at <= now()) as is_due
    from base b
  )
  select s.id, s.name, s.score, s.is_due, s.next_due_at, s.n_tracks, s.n_followers, s.n_requests,
    s.last_researched_at, s.streak,
    array_remove(array[
      case when s.n_followers > 0 then s.n_followers || ' follower' || case when s.n_followers = 1 then '' else 's' end end,
      case when s.n_requests > 0 then s.n_requests || ' request' || case when s.n_requests = 1 then '' else 's' end end,
      case when s.n_tracks = 0 then 'empty page' when s.n_tracks <= 10 then 'only ' || s.n_tracks || case when s.n_tracks = 1 then ' song' else ' songs' end end,
      case when s.last_researched_at is null then 'never checked' end,
      case when s.last_found_at > now() - interval '14 days' then 'new music found recently' end,
      case when s.streak >= 2 then 'quiet (' || s.streak || ' checks with nothing new)' end,
      case when not s.is_due then 'next check ' || to_char(s.next_due_at at time zone 'Europe/London', 'DD Mon HH24:MI') end
    ], null)
  from scored s
  where (not p_only_due or s.is_due)
  order by s.is_due desc, s.score desc, s.last_researched_at nulls first
  limit greatest(1, least(coalesce(p_limit, 50), 5000));
$function$;
revoke execute on function sc_artist_queue(integer, boolean, text[]) from public, anon, authenticated;

-- ---------- what a song still needs ----------
-- status: status unknown. link: no Spotify link. details: released but
-- missing album, release date or producers. Main songs only for status and
-- details; versions count for links.
create or replace function sc_track_needs(t tracks)
returns text[] language sql stable parallel safe as $$
  select array_remove(array[
    case when t.parent_track_id is null and coalesce(t.release_status, 'unconfirmed') = 'unconfirmed' then 'status' end,
    case when t.spotify_url is null then 'link' end,
    case when t.parent_track_id is null and t.release_status = 'released'
          and (t.album is null or t.release_date is null or t.producers is null) then 'details' end
  ], null)
$$;

-- Counts per artist: a song checked in the last 30 days isn't due again.
create or replace function sc_backlog_counts(p_artists text[])
returns table(artist_id text, needs_status bigint, needs_link bigint, needs_details bigint, checked_recently bigint, songs bigint)
language sql stable security definer set search_path to 'public' as $$
  select t.artist_id,
    count(*) filter (where 'status' = any (n) and not recent),
    count(*) filter (where 'link' = any (n) and not recent),
    count(*) filter (where 'details' = any (n) and not recent),
    count(*) filter (where cardinality(n) > 0 and recent),
    count(*)
  from (select t.artist_id, sc_track_needs(t) n, coalesce(t.routine_checked_at > now() - interval '30 days', false) recent
        from tracks t where t.artist_id = any (p_artists)) t
  group by 1
$$;
revoke execute on function sc_backlog_counts(text[]) from public, anon, authenticated;

create or replace function rpc_catalogue_backlog(p_artist_id text default null, p_kind text default null,
  p_limit int default 50, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare
  uid uuid := auth.uid();
  v_artists text[];
  v_items jsonb;
  v_counts jsonb;
begin
  if uid is null then raise exception 'not signed in'; end if;
  if p_kind is not null and p_kind not in ('status', 'link', 'details') then
    raise exception 'kind must be status, link or details';
  end if;
  if p_artist_id is not null then
    if not exists (select 1 from artists where id = p_artist_id) then raise exception 'unknown artist_id %', p_artist_id; end if;
    v_artists := array[p_artist_id];
  else
    v_artists := array(select f.artist_id from follows f where f.user_id = uid);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'artist_id', c.artist_id, 'name', a.name, 'songs', c.songs,
      'needs_status', c.needs_status, 'needs_link', c.needs_link, 'needs_details', c.needs_details,
      'checked_recently', c.checked_recently)
      order by c.needs_status + c.needs_link + c.needs_details desc), '[]'::jsonb)
  into v_counts
  from sc_backlog_counts(v_artists) c join artists a on a.id = c.artist_id;

  select coalesce(jsonb_agg(x.j order by x.ord), '[]'::jsonb) into v_items from (
    select row_number() over () ord, jsonb_build_object(
      'track_id', t.id, 'title', t.title, 'artist_id', t.artist_id, 'artist', a.name,
      'status', coalesce(t.release_status, 'unconfirmed'), 'needs', n,
      'album', t.album, 'release_date', t.release_date, 'producers', t.producers,
      'featured_artists', t.featured_artists, 'track_number', t.track_number,
      'version_of', (select p.title from tracks p where p.id = t.parent_track_id),
      'last_checked', t.routine_checked_at,
      'already_suggested_links', coalesce((select jsonb_agg(c.url) from track_link_candidates c where c.track_id = t.id), '[]'::jsonb)) j
    from (
      select t.*, sc_track_needs(t) n from tracks t
      where t.artist_id = any (v_artists)
        and (t.routine_checked_at is null or t.routine_checked_at < now() - interval '30 days')
    ) t join artists a on a.id = t.artist_id
    where cardinality(t.n) > 0 and (p_kind is null or p_kind = any (t.n))
    order by t.routine_checked_at nulls first, (t.parent_track_id is not null),
             cardinality(t.n) desc, a.name, t.title, t.id
    offset greatest(coalesce(p_offset, 0), 0)
    limit greatest(1, least(coalesce(p_limit, 50), 100))
  ) x;

  return jsonb_build_object(
    'artists', v_counts,
    'songs', v_items,
    'next_offset', greatest(coalesce(p_offset, 0), 0) + jsonb_array_length(v_items),
    'instructions',
      'needs says what each song is missing: status (unknown: find whether it is released, leaked, a snippet... and '
      || 'submit_discovery what you can prove), link (suggest_link), details (album, release date, producers: '
      || 'suggest_details with the page that shows them). Songs checked in the last 30 days are left out. Call '
      || 'mark_checked with every track_id you looked at, found or not, so the next call moves on. When songs is empty '
      || 'every follow is up to date for now (checked_recently says how many come back after 30 days).');
end $function$;
revoke execute on function rpc_catalogue_backlog(text, text, int, int) from public, anon;
grant execute on function rpc_catalogue_backlog(text, text, int, int) to authenticated;

create or replace function rpc_artist_songs(p_artist_id text, p_limit int default 100, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare v_items jsonb; v_total int;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not exists (select 1 from artists where id = p_artist_id) then raise exception 'unknown artist_id %', p_artist_id; end if;
  select count(*) into v_total from tracks where artist_id = p_artist_id;
  select coalesce(jsonb_agg(x.j order by x.ord), '[]'::jsonb) into v_items from (
    select row_number() over () ord, jsonb_build_object(
      'track_id', t.id, 'title', t.title, 'aliases', t.aliases,
      'status', coalesce(t.release_status, 'unconfirmed'),
      'version_of_track_id', t.parent_track_id,
      'album', t.album, 'release_date', t.release_date, 'track_number', t.track_number,
      'producers', t.producers, 'featured_artists', t.featured_artists,
      'has_spotify_link', t.spotify_url is not null, 'needs', sc_track_needs(t),
      'last_checked', t.routine_checked_at) j
    from tracks t where t.artist_id = p_artist_id
    order by coalesce(t.parent_track_id, t.id), t.parent_track_id is not null, t.title, t.id
    offset greatest(coalesce(p_offset, 0), 0)
    limit greatest(1, least(coalesce(p_limit, 100), 200))
  ) x;
  return jsonb_build_object('total', v_total, 'songs', v_items,
    'next_offset', case when greatest(coalesce(p_offset, 0), 0) + jsonb_array_length(v_items) < v_total
                        then greatest(coalesce(p_offset, 0), 0) + jsonb_array_length(v_items) end);
end $function$;
revoke execute on function rpc_artist_songs(text, int, int) from public, anon;
grant execute on function rpc_artist_songs(text, int, int) to authenticated;

create or replace function rpc_my_review_status(p_days int default 30)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare uid uuid := auth.uid(); v_since timestamptz;
begin
  if uid is null then raise exception 'not signed in'; end if;
  v_since := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)));
  return jsonb_build_object(
    'since', v_since::date,
    'discoveries', (select jsonb_build_object(
        'waiting', count(*) filter (where state = 'open'),
        'added', count(*) filter (where state = 'promoted'),
        'dismissed', count(*) filter (where state in ('dismissed', 'stale')),
        'recent', coalesce((select jsonb_agg(jsonb_build_object('title', d.title, 'version', d.version_hint, 'to_status', d.to_status,
                     'outcome', case d.state when 'open' then 'waiting' when 'promoted' then 'added' else 'dismissed' end,
                     'note', d.review_note, 'track_id', d.matched_track_id) order by coalesce(d.reviewed_at, d.last_seen_at) desc)
                   from (select * from discoveries where first_seen_by = uid and last_seen_at > v_since
                         order by coalesce(reviewed_at, last_seen_at) desc limit 30) d), '[]'::jsonb))
      from discoveries where first_seen_by = uid and last_seen_at > v_since),
    'suggestions', (select jsonb_build_object(
        'waiting', count(*) filter (where status = 'pending'),
        'approved', count(*) filter (where status = 'approved'),
        'rejected', count(*) filter (where status = 'rejected'),
        'recent', coalesce((select jsonb_agg(jsonb_build_object('type', s.type, 'track_id', s.payload ->> 'track_id',
                     'outcome', s.status, 'note', s.reviewer_note) order by s.created_at desc)
                   from (select * from submissions where submitted_by = uid and created_at > v_since
                         order by created_at desc limit 30) s), '[]'::jsonb))
      from submissions where submitted_by = uid and created_at > v_since),
    'links_suggested', (select count(*) from track_link_candidates where suggested_by = uid and found_at > v_since),
    'duplicate_reports', (select count(*) from duplicate_reports where user_id = uid and created_at > v_since),
    'note', 'Rejected or dismissed items were turned down by the reviewer: don''t send them again without new evidence.');
end $function$;
revoke execute on function rpc_my_review_status(int) from public, anon;
grant execute on function rpc_my_review_status(int) to authenticated;

-- ---------- suggest_details: corrections ----------
create or replace function rpc_suggest_details(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  t tracks%rowtype;
  v jsonb := '{}'::jsonb;
  was jsonb := '{}'::jsonb;
  v_date date;
  v_replace boolean := coalesce((p ->> 'replace')::boolean, false);
  x text;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into t from tracks where id = p ->> 'track_id';
  if t.id is null then raise exception 'unknown track_id'; end if;
  if v_replace and nullif(trim(coalesce(p ->> 'notes', '')), '') is null then
    raise exception 'corrections need notes saying what is wrong and why';
  end if;

  x := nullif(trim(p ->> 'album'), '');
  if x is not null and (t.album is null or (v_replace and lower(t.album) <> lower(x))) then
    v := v || jsonb_build_object('album', left(x, 200)); was := was || jsonb_build_object('album', t.album); end if;
  x := nullif(trim(p ->> 'producers'), '');
  if x is not null and (t.producers is null or (v_replace and lower(t.producers) <> lower(x))) then
    v := v || jsonb_build_object('producers', left(x, 300)); was := was || jsonb_build_object('producers', t.producers); end if;
  x := nullif(trim(p ->> 'featured_artists'), '');
  if x is not null and (t.featured_artists is null or (v_replace and lower(t.featured_artists) <> lower(x))) then
    v := v || jsonb_build_object('featured_artists', left(x, 300)); was := was || jsonb_build_object('featured_artists', t.featured_artists); end if;
  if (p ->> 'track_number') ~ '^\d{1,3}$'
     and (t.track_number is null or (v_replace and t.track_number <> (p ->> 'track_number')::int)) then
    v := v || jsonb_build_object('track_number', p ->> 'track_number'); was := was || jsonb_build_object('track_number', t.track_number); end if;
  if (p ->> 'release_date') ~ '^\d{4}-\d{2}-\d{2}$' then
    begin
      v_date := (p ->> 'release_date')::date;
      if extract(year from v_date) between 1900 and 2100
         and (t.release_date is null or (v_replace and t.release_date <> v_date)) then
        v := v || jsonb_build_object('release_date', v_date::text); was := was || jsonb_build_object('release_date', t.release_date);
      end if;
    exception when others then null;
    end;
  end if;

  if v = '{}'::jsonb then
    return jsonb_build_object('ok', true, 'sent', false, 'note',
      case when v_replace then 'Nothing to change: the song already has those values.'
           else 'Nothing new: those details are already filled in. To fix a wrong value, call again with replace = true and notes.' end);
  end if;
  if exists (select 1 from submissions where type = 'correction' and status = 'pending' and payload ->> 'track_id' = t.id
             and payload ->> 'from' = 'routine') then
    return jsonb_build_object('ok', true, 'sent', false, 'note', 'A suggestion for this song is already waiting for review.');
  end if;
  insert into submissions (type, artist_id, payload, submitted_by)
  values ('correction', t.artist_id,
          v || jsonb_build_object('track_id', t.id, 'from', 'routine',
                                  'source_url', nullif(p ->> 'source_url', ''),
                                  'previous', case when v_replace then was end,
                                  'reviewer_note', left(
                                    case when v_replace then 'Correction (was: '
                                      || (select string_agg(k || ' = ' || coalesce(was ->> k, 'empty'), '; ') from jsonb_object_keys(was) k)
                                      || '). ' else '' end || coalesce(p ->> 'notes', ''), 1000)),
          auth.uid());
  return jsonb_build_object('ok', true, 'sent', true, 'correction', v_replace, 'fields', (select jsonb_agg(k) from jsonb_object_keys(v) k));
end $function$;

-- ---------- research plan: rank the user's follows, add backlog ----------
do $$
declare d text := pg_get_functiondef('rpc_research_plan(integer)'::regprocedure);
begin
  d := replace(d, 'join sc_artist_queue(500, false) q on q.artist_id = ar.id',
                  'join sc_artist_queue(500, false, array(select f2.artist_id from follows f2 where f2.user_id = uid)) q on q.artist_id = ar.id');
  d := replace(d, $q$    'artists', result,$q$,
    $q$    'artists', result,
    'due_now', (select count(*) from jsonb_array_elements(result) a where (a ->> 'due')::boolean),
    'catalogue_backlog', (select jsonb_build_object(
        'needs_status', coalesce(sum(needs_status), 0), 'needs_link', coalesce(sum(needs_link), 0),
        'needs_details', coalesce(sum(needs_details), 0))
      from sc_backlog_counts(array(select f3.artist_id from follows f3 where f3.user_id = uid))),
    'when_nothing_is_due', 'No news research is due when every artist has due = false. That does not mean the catalogue is complete: work through get_catalogue_backlog (statuses, links, details) instead.',$q$);
  if position('f2.user_id = uid' in d) = 0 or position('catalogue_backlog' in d) = 0 then raise exception 'research plan patch failed'; end if;
  execute d;
end $$;

-- Corrections that overwrite filled fields always wait for a person, even
-- from trusted contributors.
do $$
declare d text := pg_get_functiondef('submissions_trusted_apply()'::regprocedure);
begin
  d := replace(d, $q$or coalesce(new.payload ->> 'from', '') = 'local' then$q$,
                  $q$or coalesce(new.payload ->> 'from', '') = 'local'
     -- Corrections that overwrite filled fields always wait for a person.
     or jsonb_typeof(new.payload -> 'previous') = 'object' then$q$);
  if position('payload -> ''previous''' in d) = 0 then raise exception 'patch failed'; end if;
  execute d;
end $$;
