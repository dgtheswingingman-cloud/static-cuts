-- ChatGPT handover (26 Nov): give the Static-Cuts connector (ChatGPT) read
-- access to NIX's work, catalogue integrity and research coverage, plus one
-- controlled write (a second opinion on a NIX finding), and log every
-- connector call.
--
-- Safeguards:
--  * Connected apps still can't act as admin or moderator (is_admin /
--    is_moderator refuse OAuth clients). The new read tools use their own
--    check, sc_is_owner_account(): the signed-in account is the site owner's
--    (owner_user_id), whether through the site or a connected app. Nothing
--    here reads emails, keys or other users' private data.
--  * The only write is nix_second_opinions: a verdict shown next to Claude's
--    on the review page. It never changes a song.
--  * mcp_calls: every connector call (tool, who, app, ok/error, a trimmed copy
--    of the arguments, time taken), kept 90 days.

create or replace function public.sc_is_owner_account() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
     and auth.uid()::text = (select value from sc_private_settings where key = 'owner_user_id')
$$;
revoke all on function public.sc_is_owner_account() from public, anon;
grant execute on function public.sc_is_owner_account() to authenticated;

-- ---------------------------------------------------------------- call log
create table if not exists public.mcp_calls (
  id bigserial primary key,
  at timestamptz not null default now(),
  user_id uuid,
  client_id text,
  tool text not null,
  ok boolean not null,
  error text,
  args jsonb,
  ms integer
);
create index if not exists mcp_calls_at on public.mcp_calls (at desc);
alter table public.mcp_calls enable row level security;

create or replace function public.rpc_log_mcp_call(p_tool text, p_ok boolean, p_error text default null, p_args jsonb default null, p_ms integer default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  insert into mcp_calls (user_id, client_id, tool, ok, error, args, ms)
  values (auth.uid(), nullif(auth.jwt() ->> 'client_id', ''), left(p_tool, 80), coalesce(p_ok, false), left(p_error, 500),
          case when p_args is null then null when length(p_args::text) <= 1500 then p_args
               else jsonb_build_object('trimmed', left(p_args::text, 1500)) end,
          p_ms);
  if random() < 0.01 then delete from mcp_calls where at < now() - interval '90 days'; end if;
end $$;
revoke all on function public.rpc_log_mcp_call(text, boolean, text, jsonb, integer) from public, anon;
grant execute on function public.rpc_log_mcp_call(text, boolean, text, jsonb, integer) to authenticated;

-- Control room: recent connector calls (admins on the site).
create or replace function public.admin_mcp_calls(p_limit integer default 100)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when is_admin() then jsonb_build_object(
    'summary', (select coalesce(jsonb_agg(x order by x.calls desc), '[]') from (
        select tool, count(*) calls, count(*) filter (where not ok) errors, max(at) last
        from mcp_calls where at > now() - interval '7 days' group by tool) x),
    'calls', (select coalesce(jsonb_agg(jsonb_build_object(
        'at', c.at, 'tool', c.tool, 'ok', c.ok, 'error', c.error, 'args', c.args, 'ms', c.ms,
        'who', coalesce(p.display_name, 'someone'), 'app', c.client_id) order by c.at desc), '[]')
      from (select * from mcp_calls order by at desc limit greatest(1, least(coalesce(p_limit, 100), 500))) c
      left join profiles p on p.id = c.user_id)) end
$$;
grant execute on function public.admin_mcp_calls(integer) to authenticated;

-- ---------------------------------------------------------- second opinions
create table if not exists public.nix_second_opinions (
  id bigserial primary key,
  item_key text not null,            -- 's:<suggestion id>' or 'n:<kind>:<item key>'
  user_id uuid not null,
  client_id text,
  verdict text not null check (verdict in ('agree', 'disagree', 'unsure')),
  answer text,
  note text,
  source_url text,
  created_at timestamptz not null default now(),
  unique (item_key, user_id)
);
alter table public.nix_second_opinions enable row level security;

create or replace function public.rpc_nix_second_opinion(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare k text := btrim(coalesce(p ->> 'item_key', '')); v text := lower(btrim(coalesce(p ->> 'verdict', '')));
  kd text; ik text; ok boolean;
begin
  if not sc_is_owner_account() then raise exception 'Only the site owner''s account can do this.'; end if;
  if v not in ('agree', 'disagree', 'unsure') then raise exception 'verdict must be agree, disagree or unsure'; end if;
  if v = 'disagree' and nullif(btrim(coalesce(p ->> 'answer', '')), '') is null then
    raise exception 'Say what the right answer is (answer) when you disagree.';
  end if;
  if nullif(p ->> 'source_url', '') is not null and (p ->> 'source_url') !~* '^https?://' then
    raise exception 'source_url must be an http(s) link';
  end if;
  if k ~ '^s:\d+$' then
    ok := exists (select 1 from nix_suggestions where id = substring(k from 3)::bigint);
  elsif k ~ '^n:[a-z]+:.+' then
    kd := split_part(k, ':', 2);
    ik := substring(k from length(kd) + 4);
    ok := exists (select 1 from nix_notes where kind = kd and item_key = ik);
  else
    raise exception 'item_key must look like s:123 or n:kind:key (from get_nix_findings)';
  end if;
  if not ok then raise exception 'No NIX finding with that item_key.'; end if;
  insert into nix_second_opinions (item_key, user_id, client_id, verdict, answer, note, source_url)
  values (k, auth.uid(), nullif(auth.jwt() ->> 'client_id', ''), v,
          left(nullif(btrim(coalesce(p ->> 'answer', '')), ''), 200), left(nullif(btrim(coalesce(p ->> 'note', '')), ''), 1000),
          left(nullif(p ->> 'source_url', ''), 1000))
  on conflict (item_key, user_id) do update set verdict = excluded.verdict, answer = excluded.answer, note = excluded.note,
    source_url = excluded.source_url, client_id = excluded.client_id, created_at = now();
  return jsonb_build_object('ok', true, 'item_key', k, 'verdict', v);
end $$;
revoke all on function public.rpc_nix_second_opinion(jsonb) from public, anon;
grant execute on function public.rpc_nix_second_opinion(jsonb) to authenticated;

-- ------------------------------------------------------------- NIX overview
create or replace function public.rpc_nix_overview()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not sc_is_owner_account() then raise exception 'Only the site owner''s account can see NIX''s internals.'; end if;
  select jsonb_build_object(
    'pc', (select coalesce(jsonb_agg(jsonb_build_object('worker', worker, 'ollama_running', ollama, 'model', model, 'installed_models', models,
             'last_seen', last_seen, 'online', last_seen > now() - interval '3 minutes', 'last_error', last_error)), '[]') from nix_ai_workers),
    'jobs_on_pc', jsonb_build_object(
      'queued_now', (select count(*) from nix_ai_jobs where status = 'queued'),
      'running_now', (select count(*) from nix_ai_jobs where status = 'running'),
      'last_24h', (select coalesce(jsonb_object_agg(k, n), '{}') from (
          select split_part(kind, ':', 1) || ':' || coalesce(split_part(kind, ':', 2), '') || ' ' || status k, count(*) n
          from nix_ai_jobs where coalesce(finished_at, claimed_at, created_at) > now() - interval '24 hours' group by 1) x),
      'avg_seconds_24h', (select round(avg(ms) / 1000.0, 1) from nix_ai_jobs where finished_at > now() - interval '24 hours')),
    'work_left', (select coalesce(jsonb_object_agg(kind, n), '{}') from (select kind, count(*) n from nix_work group by kind) w),
    'jobs_switched_on', (select value from sc_private_settings where key = 'nix_suggest_kinds'),
    'claude_checker', jsonb_build_object(
      'month_cap_usd', sc_ai_month_cap(), 'month_spent_usd', round(sc_ai_month_usd(), 2),
      'today_spent_usd', (select round(coalesce(sum(usd), 0), 2) from ai_spend where day = current_date),
      'can_spend_now', sc_ai_can_spend('background')),
    'suggestions_open', (select coalesce(jsonb_object_agg(kind, piles), '{}') from (
        select kind, jsonb_object_agg(pile, n) piles from (
          select kind, coalesce(check_verdict, 'unchecked') pile, count(*) n from nix_suggestions where state = 'open' group by 1, 2) a group by kind) b),
    'accuracy_by_job', (select coalesce(jsonb_agg(x order by x.job), '[]') from (
        select kind job, count(*) checked,
          count(*) filter (where check_verdict in ('agree') or final_side = 'nix') nix_right,
          count(*) filter (where final_side in ('checker', 'neither') or check_verdict = 'corrected') nix_wrong,
          count(*) filter (where check_verdict = 'unsure' and final_side is null) unsure
        from (select kind, check_verdict, final_side from nix_suggestions where checked_at > now() - interval '30 days'
              union all select kind, check_verdict, final_side from nix_notes where checked_at > now() - interval '30 days') s
        group by kind) x),
    'decisions_by_owner_30d', (select coalesce(jsonb_object_agg(k, n), '{}') from (
        select kind || ' ' || state k, count(*) n from nix_suggestions
        where decided_by is not null and decided_at > now() - interval '30 days' group by 1) d),
    'weekly_summary', (select report from nix_weekly order by week_start desc limit 1),
    'schedule', (select coalesce(jsonb_agg(jsonb_build_object('task', name, 'enabled', enabled,
                   'every', coalesce(at_time::text || ' UTC daily', every::text), 'last_run', last_run_at, 'next', next_at,
                   'last_result', left(last_result, 200)) order by name), '[]') from nix_tasks),
    'learned_rules', (select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'pattern', pattern, 'action', action, 'state', state,
                   'said_yes', said_yes, 'said_no', said_no) order by created_at desc), '[]')
                from (select * from nix_rules order by created_at desc limit 30) r),
    'how_it_works', 'NIX is a small AI model on the owner''s laptop. It makes suggestions (titles, notes, eras, version audit, status & copies) '
                 || 'and review notes (duplicates, clean-up, bio mix-ups, Deezer, found links). Claude checks every one (agree / disagree / unsure); '
                 || 'disagreements get a careful final say. Nothing changes on the site until the owner accepts it, except agreed title fixes '
                 || 'and agreed found links, which apply daily as undoable batches.')
  into r;
  return r;
end $$;
revoke all on function public.rpc_nix_overview() from public, anon;
grant execute on function public.rpc_nix_overview() to authenticated;

-- ------------------------------------------------------------- NIX findings
create or replace function public.rpc_nix_findings(p_source text default null, p_kind text default null, p_pile text default null,
  p_artist text default null, p_state text default 'open', p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare lim int := greatest(1, least(coalesce(p_limit, 50), 200)); r jsonb;
begin
  if not sc_is_owner_account() then raise exception 'Only the site owner''s account can see NIX''s internals.'; end if;
  with s as (
    select 's:' || s.id item_key, 'suggestion' source, s.kind, s.state, s.created_at,
      jsonb_build_object('track_id', s.track_id, 'song', t.title, 'artist_id', t.artist_id, 'artist', a.name, 'song_status', t.release_status,
        'field', s.field, 'current_value', s.current_value, 'nix_says', s.suggested, 'nix_why', s.note, 'nix_sure', s.confidence, 'model', s.model,
        'copy_of_track_id', s.target_track_id) detail,
      coalesce(s.check_verdict, 'unchecked') pile, s.check_answer, s.check_note, s.final_side, s.final_answer, s.final_note, s.corrected
    from nix_suggestions s join tracks t on t.id = s.track_id left join artists a on a.id = t.artist_id
    where (p_source is null or p_source = 'suggestions')
      and (p_kind is null or s.kind = p_kind)
      and (p_artist is null or t.artist_id = p_artist)
      and (p_state is null or s.state = p_state)
  ), n as (
    select 'n:' || n.kind || ':' || n.item_key item_key, 'review_note' source, n.kind, 'open' state, n.created_at,
      jsonb_build_object('what_nix_saw', n.line, 'nix_says', n.verdict, 'nix_why', n.note, 'model', n.model) detail,
      coalesce(n.check_verdict, 'unchecked') pile, n.check_answer, n.check_note, n.final_side, n.final_answer, n.final_note, null::text corrected
    from nix_notes n
    where n.line is not null and p_artist is null
      and (p_source is null or p_source = 'notes')
      and (p_kind is null or n.kind = p_kind)
      and (p_state is null or p_state = 'open')
  ), allx as (select * from s union all select * from n)
  select jsonb_build_object(
    'piles', (select coalesce(jsonb_object_agg(pile, c), '{}') from (select pile, count(*) c from allx group by pile) p),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('item_key', x.item_key, 'source', x.source, 'kind', x.kind, 'state', x.state,
        'made_at', x.created_at) || x.detail || jsonb_build_object(
        'claude_check', x.pile, 'claude_answer', x.check_answer, 'claude_why', x.check_note,
        'final_say', x.final_side, 'final_answer', x.final_answer, 'final_why', x.final_note, 'corrected_value', x.corrected,
        'your_second_opinion', (select jsonb_build_object('verdict', o.verdict, 'answer', o.answer, 'note', o.note)
                                from nix_second_opinions o where o.item_key = x.item_key and o.user_id = auth.uid()))
        order by x.created_at desc), '[]')
      from (select * from allx where p_pile is null or pile = p_pile order by created_at desc
            offset greatest(coalesce(p_offset, 0), 0) limit lim) x),
    'next_offset', case when (select count(*) from allx where p_pile is null or pile = p_pile) > greatest(coalesce(p_offset, 0), 0) + lim
                        then greatest(coalesce(p_offset, 0), 0) + lim end)
  into r;
  return r;
end $$;
revoke all on function public.rpc_nix_findings(text, text, text, text, text, integer, integer) from public, anon;
grant execute on function public.rpc_nix_findings(text, text, text, text, text, integer, integer) to authenticated;

-- ------------------------------------------------------------- NIX failures
create or replace function public.rpc_nix_failures(p_days integer default 3)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d interval := make_interval(days => greatest(1, least(coalesce(p_days, 3), 30))); r jsonb;
begin
  if not sc_is_owner_account() then raise exception 'Only the site owner''s account can see NIX''s internals.'; end if;
  select jsonb_build_object(
    'failed_pc_jobs', (select coalesce(jsonb_agg(x order by x.last desc), '[]') from (
        select kind, model, left(coalesce(error, '?'), 200) error, count(*) times, max(coalesce(finished_at, claimed_at)) last
        from nix_ai_jobs where status = 'failed' and coalesce(finished_at, claimed_at, created_at) > now() - d
        group by 1, 2, 3) x),
    'stuck_pc_jobs', (select count(*) from nix_ai_jobs where status = 'running' and claimed_at < now() - interval '15 minutes'),
    'oldest_queued_job', (select min(created_at) from nix_ai_jobs where status = 'queued'),
    'tasks_with_problems', (select coalesce(jsonb_agg(jsonb_build_object('task', name, 'last_run', last_run_at, 'last_result', left(last_result, 300),
          'overdue', last_run_at < now() - coalesce(max_every, every) * 2) order by name), '[]')
        from nix_tasks where enabled and (last_result ~* '"error"|fail|stopped":"(couldn|no )' or last_run_at < now() - coalesce(max_every, every) * 2
                                          or running_since < now() - interval '15 minutes')),
    'job_errors', (select coalesce(jsonb_agg(x order by x.last desc), '[]') from (
        select job, left(error, 200) error, count(*) times, max(started_at) last
        from job_runs where error is not null and started_at > now() - d group by 1, 2 order by 4 desc limit 30) x),
    'checker_stalled', (select count(*) from nix_suggestions where state = 'open' and checked_at is null and created_at < now() - interval '1 day'))
  into r;
  return r;
end $$;
revoke all on function public.rpc_nix_failures(integer) from public, anon;
grant execute on function public.rpc_nix_failures(integer) to authenticated;

-- ------------------------------------------------------- artist completeness
-- Same measures as the control room's progress cards, for any artist.
create or replace function public.sc_artist_progress(p_artist text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'songs', count(t.id),
    'status', count(t.id) filter (where coalesce(t.release_status, 'unconfirmed') <> 'unconfirmed'),
    'link_of', count(t.id) filter (where t.release_status in ('released', 'leaked', 'snippet')),
    'link', count(t.id) filter (where t.release_status in ('released', 'leaked', 'snippet') and coalesce(t.spotify_url, t.deezer_url, t.apple_url) is not null),
    'date_of', count(t.id) filter (where t.release_status = 'leaked'),
    'date', count(t.id) filter (where t.release_status = 'leaked' and t.leak_date is not null),
    'era_of', count(t.id) filter (where coalesce(t.release_status, 'unconfirmed') <> 'released'),
    'era', count(t.id) filter (where coalesce(t.release_status, 'unconfirmed') <> 'released' and nullif(t.album, '') is not null),
    'cover_of', count(t.id) filter (where t.release_status in ('leaked', 'snippet')),
    'cover', count(t.id) filter (where t.release_status in ('leaked', 'snippet') and coalesce(t.cover_url, t.fan_cover_url) is not null))
  from tracks t where t.artist_id = p_artist and t.parent_track_id is null
$$;
revoke all on function public.sc_artist_progress(text) from public, anon, authenticated;

create or replace function public.rpc_completeness_report(p_artist text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('artist_id', a.id, 'artist', a.name, 'main_artist', l.artist_id is not null,
             'now', sc_artist_progress(a.id),
             'week_ago', (select d.data from launch_progress_days d where d.artist_id = a.id and d.day between current_date - 7 and current_date - 1 order by d.day limit 1))
           order by l.position nulls last, a.name), '[]')
    from artists a left join launch_artists l on l.artist_id = a.id
    where (p_artist is not null and a.id = p_artist) or (p_artist is null and l.artist_id is not null));
end $$;
revoke all on function public.rpc_completeness_report(text) from public, anon;
grant execute on function public.rpc_completeness_report(text) to authenticated;

-- ------------------------------------------------------ catalogue integrity
create or replace function public.rpc_catalogue_integrity(p_artist text default null, p_kind text default null, p_limit integer default 20)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare lim int := greatest(1, least(coalesce(p_limit, 20), 100)); r jsonb;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  with arts as (
    select a.id from artists a where (p_artist is not null and a.id = p_artist)
      or (p_artist is null and exists (select 1 from launch_artists l where l.artist_id = a.id))
  ), t as (
    select t.id, t.title, t.artist_id, t.release_status, t.release_date, t.leak_date, t.album, t.spotify_url, t.cover_url, t.fan_cover_url, t.parent_track_id
    from tracks t join arts on arts.id = t.artist_id
  ), issues as (
    select 'dead_link' kind, t.id, t.title, t.artist_id, jsonb_build_object('url', t.spotify_url, 'confirmed_dead', lc.dead_confirmed_at) info
      from t join link_checks lc on lc.url = t.spotify_url where lc.dead_confirmed_at is not null
    union all
    select 'leak_after_release', t.id, t.title, t.artist_id, jsonb_build_object('release_date', t.release_date, 'leak_date', t.leak_date)
      from t where t.release_date is not null and t.leak_date is not null and t.leak_date > t.release_date
    union all
    select 'unreleased_with_release_date', t.id, t.title, t.artist_id, jsonb_build_object('status', t.release_status, 'release_date', t.release_date)
      from t where t.release_status in ('leaked', 'snippet', 'rumored', 'teased') and t.release_date is not null and t.parent_track_id is null
    union all
    select 'released_no_date', t.id, t.title, t.artist_id, jsonb_build_object('album', t.album)
      from t where t.release_status = 'released' and t.release_date is null and t.parent_track_id is null
    union all
    select 'unknown_status', t.id, t.title, t.artist_id, '{}'::jsonb
      from t where coalesce(t.release_status, 'unconfirmed') = 'unconfirmed' and t.parent_track_id is null
    union all
    select 'leak_no_cover', t.id, t.title, t.artist_id, jsonb_build_object('status', t.release_status)
      from t where t.release_status in ('leaked', 'snippet') and coalesce(t.cover_url, t.fan_cover_url) is null and t.parent_track_id is null
    union all
    select 'tracker_disagrees', d.track_id, t.title, t.artist_id,
           jsonb_build_object('site_status', d.current_status, 'tracker_status', d.tracker_status, 'tracker_title', d.tracker_title)
      from tracker_disagreements d join t on t.id = d.track_id where d.state = 'open'
  )
  select jsonb_build_object(
    'scope', coalesce(p_artist, 'main artists'),
    'counts', (select coalesce(jsonb_object_agg(kind, n), '{}') from (select kind, count(*) n from issues group by kind) c),
    'duplicate_groups', (select count(*) from duplicate_candidates d where cardinality(d.ids) > 1 and d.artists && array(select id from arts)
                           and not exists (select 1 from duplicate_dismissals x where x.group_id = d.group_id)),
    'examples', (select coalesce(jsonb_object_agg(kind, items), '{}') from (
        select kind, jsonb_agg(jsonb_build_object('track_id', id, 'song', title, 'artist_id', artist_id) || info) items
        from (select *, row_number() over (partition by kind order by title) rn from issues where p_kind is null or kind = p_kind) i
        where rn <= case when p_kind is null then least(lim, 5) else lim end group by kind) e),
    'how_to_fix', 'Status, dates and albums: suggest_details (replace = true for wrong values). Dead links: suggest_link with a working one. '
               || 'Covers: suggest_cover. Duplicates: get_possible_duplicates and report_duplicate. All of it is reviewed by a person.')
  into r;
  return r;
end $$;
revoke all on function public.rpc_catalogue_integrity(text, text, integer) from public, anon;
grant execute on function public.rpc_catalogue_integrity(text, text, integer) to authenticated;

-- -------------------------------------------------------- research coverage
create or replace function public.rpc_research_coverage(p_artist text default null, p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d interval := make_interval(days => greatest(1, least(coalesce(p_days, 30), 365))); r jsonb;
begin
  if not sc_is_owner_account() then raise exception 'Only the site owner''s account can see research coverage for everyone.'; end if;
  with arts as (
    select a.id, a.name from artists a where (p_artist is not null and a.id = p_artist)
      or (p_artist is null and exists (select 1 from launch_artists l where l.artist_id = a.id))
  )
  select jsonb_build_object(
    'artists', (select coalesce(jsonb_agg(jsonb_build_object(
        'artist_id', a.id, 'artist', a.name,
        'last_researched_at', s.last_researched_at, 'times_researched', s.research_count, 'next_due_at', s.next_due_at,
        'last_found_something_at', s.last_found_at, 'quiet_streak', s.quiet_streak,
        'discoveries', (select coalesce(jsonb_object_agg(state, n), '{}') from (select state, count(*) n from discoveries x
                          where x.artist_id = a.id and x.first_seen_at > now() - d group by state) q),
        'youtube_searches', (select jsonb_build_object('searched', count(*), 'found_something', count(*) filter (where y.found > 0))
                             from youtube_searches y join tracks t on t.id = y.track_id where t.artist_id = a.id and y.searched_at > now() - d),
        'spotify_searched_not_found', (select count(*) from tracks t where t.artist_id = a.id and t.parent_track_id is null
                                        and t.spotify_url is null and t.spotify_search_attempted_at is not null))
      order by a.name), '[]') from arts a left join artist_research_state s on s.artist_id = a.id),
    'routine_runs', (select coalesce(jsonb_agg(x order by x.last desc), '[]') from (
        select coalesce(client_id, 'site') app, count(*) runs, sum(artists_checked) artists, sum(findings) findings, sum(submitted) submitted, max(started_at) last
        from routine_runs where started_at > now() - d group by 1) x),
    'submissions', (select coalesce(jsonb_object_agg(k, n), '{}') from (
        select type || ' ' || status k, count(*) n from submissions where created_at > now() - d
          and (p_artist is null or artist_id = p_artist) group by 1) x),
    'discoveries', (select coalesce(jsonb_object_agg(state, n), '{}') from (
        select state, count(*) n from discoveries where first_seen_at > now() - d and (p_artist is null or artist_id = p_artist) group by state) x),
    'waiting_for_review', (select count(*) from discoveries where state = 'open' and (p_artist is null or artist_id = p_artist)),
    'top_rejection_reasons', (select coalesce(jsonb_agg(x order by x.times desc), '[]') from (
        select left(note, 160) reason, count(*) times from (
          select reviewer_note note from submissions where status = 'rejected' and created_at > now() - d and nullif(reviewer_note, '') is not null
            and (p_artist is null or artist_id = p_artist)
          union all
          select review_note from discoveries where state = 'dismissed' and first_seen_at > now() - d and nullif(review_note, '') is not null
            and (p_artist is null or artist_id = p_artist)) z
        group by 1 order by 2 desc limit 10) x),
    'source_reliability', (select coalesce(jsonb_agg(x order by x.finds desc), '[]') from (
        select substring(e.source_url from '^https?://(?:www\.)?([^/]+)') source, count(distinct x.id) finds,
          count(distinct x.id) filter (where x.state = 'promoted') accepted,
          count(distinct x.id) filter (where x.state = 'dismissed') dismissed
        from discovery_evidence e join discoveries x on x.id = e.discovery_id
        where e.created_at > now() - d and (p_artist is null or x.artist_id = p_artist)
        group by 1 having count(distinct x.id) >= 2 order by 2 desc limit 15) x))
  into r;
  return r;
end $$;
revoke all on function public.rpc_research_coverage(text, integer) from public, anon;
grant execute on function public.rpc_research_coverage(text, integer) to authenticated;

-- Review page: ChatGPT's second opinion next to Claude's.
do $$
declare d text := pg_get_functiondef('public.admin_nix_suggestions(text, integer, text)'::regprocedure);
begin
  d := replace(d, $p$'corrected', s.corrected, 'final_side', s.final_side, 'final_note', s.final_note) x$p$,
                  $p$'corrected', s.corrected, 'final_side', s.final_side, 'final_note', s.final_note,
        'second', (select jsonb_build_object('verdict', o.verdict, 'answer', o.answer, 'note', o.note, 'source_url', o.source_url)
                   from nix_second_opinions o where o.item_key = 's:' || s.id order by o.created_at desc limit 1)) x$p$);
  if position('nix_second_opinions' in d) = 0 then raise exception 'patch missed: admin_nix_suggestions'; end if;
  execute d;
end $$;
