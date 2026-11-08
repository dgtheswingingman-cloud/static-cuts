-- The research plan ChatGPT reads first took 7 s and was ~130K characters
-- (mostly 100-song watch lists per artist), which ate the model's context.
-- Now: 8 artists by default (max 25), watch list 25 songs (least recently
-- checked first), shorter skip lists, and "recently added" found through
-- indexes instead of reading every song once per artist.
create or replace function rpc_research_plan(p_limit integer default 8)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  uid uuid := auth.uid();
  result jsonb;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;

  with picked as (
    select ar.id, ar.name, q.due, q.score, q.reasons, q.track_count, rs.last_researched_at
    from follows f
    join artists ar on ar.id = f.artist_id
    join sc_artist_queue(500, false) q on q.artist_id = ar.id
    left join artist_research_state rs on rs.artist_id = ar.id
    where f.user_id = uid
    order by q.due desc, q.score desc
    limit greatest(1, least(coalesce(p_limit, 8), 25))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'artist_id', p.id,
      'name', p.name,
      'due', p.due,
      'why', to_jsonb(p.reasons),
      'last_researched_at', p.last_researched_at,
      'researched_recently', not p.due,
      -- Two days of overlap so nothing slips between runs.
      'search_since', to_char((p.last_researched_at - interval '2 days') at time zone 'UTC', 'YYYY-MM-DD'),
      'known_track_count', p.track_count,
      'watch_list', coalesce((
        select jsonb_agg(jsonb_build_object('track_id', t.id, 'title', t.title, 'status', t.release_status))
        from (
          select id, title, release_status from tracks t
          where t.artist_id = p.id and t.release_status in ('rumored', 'teased', 'snippet', 'announced')
          order by t.routine_checked_at nulls first, t.title limit 25
        ) t
      ), '[]'::jsonb),
      'needs_status', coalesce((
        select jsonb_agg(jsonb_build_object('track_id', t.id, 'title', t.title))
        from (
          select id, title from tracks t
          where t.artist_id = p.id and t.release_status = 'unconfirmed' and t.parent_track_id is null
          order by t.routine_checked_at nulls first, t.title
          limit 10
        ) t
      ), '[]'::jsonb),
      'recently_added', coalesce((
        select jsonb_agg(jsonb_build_object('title', r.title, 'status', r.release_status) order by r.created_at desc nulls last)
        from (
          select * from (
            select distinct on (x.id) x.id, x.title, x.release_status, x.created_at from (
              select t.id, t.title, t.release_status, t.created_at from tracks t
              where t.artist_id = p.id and t.created_at > now() - interval '60 days'
              union all
              select t.id, t.title, t.release_status, t.created_at from track_appearances a join tracks t on t.id = a.track_id
              where a.artist_id = p.id and t.created_at > now() - interval '60 days'
              union all
              select t.id, t.title, t.release_status, t.created_at from track_status_events e join tracks t on t.id = e.track_id
              where t.artist_id = p.id and e.created_at > now() - interval '60 days'
            ) x
            order by x.id
          ) u
          order by u.created_at desc nulls last limit 30
        ) r
      ), '[]'::jsonb),
      'already_handled', coalesce((
        select jsonb_agg(jsonb_build_object(
          'title', d.title, 'version', d.version_hint, 'status', d.to_status,
          'outcome', case when d.state = 'promoted' then 'added' else 'dismissed' end))
        from (
          select title, version_hint, to_status, state from discoveries d
          where (d.artist_id = p.id or d.main_artist_id = p.id)
            and d.state in ('promoted', 'dismissed', 'stale')
            and coalesce(d.reviewed_at, d.last_seen_at) > now() - interval '90 days'
          order by coalesce(d.reviewed_at, d.last_seen_at) desc limit 30
        ) d
      ), '[]'::jsonb),
      'open_discoveries', coalesce((
        select jsonb_agg(jsonb_build_object('title', d.title, 'version', d.version_hint,
                                            'to_status', d.to_status, 'type', d.development_type))
        from (
          select title, version_hint, to_status, development_type from discoveries d
          where (d.artist_id = p.id or d.main_artist_id = p.id) and d.state = 'open'
          order by last_seen_at desc limit 30
        ) d
      ), '[]'::jsonb)
    ) order by p.due desc, p.score desc), '[]'::jsonb) into result
  from picked p;

  return jsonb_build_object(
    'artists', result,
    'note', 'Shared across everyone using Static Cuts, so don''t redo work. Artists come in priority order. '
      || 'Research the ones with due = true; skip ones with due = false unless you have time left (they were '
      || 'checked recently or have been quiet). For each artist: only look for news dated on or after '
      || 'search_since (null means never checked: do a full sweep). Skip anything in recently_added, '
      || 'already_handled or open_discoveries without checking it. Check the rest with check_candidates '
      || '(up to 100 titles in one call) before submitting. needs_status lists songs whose status is unknown: '
      || 'find out whether each is released, leaked, a snippet etc., submit what you can prove, then call '
      || 'mark_checked with the track_ids. Always call finish_run at the end with every artist you researched. '
      || 'Call get_research_plan again after finish_run for the next batch if you have time.'
  );
end;
$function$;
