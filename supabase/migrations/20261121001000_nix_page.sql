-- NIX page (/nix): what NIX did, what it fixed, what went wrong and what's stuck.

create or replace function public.admin_nix()
returns jsonb language plpgsql stable security definer set search_path to 'public', 'cron' as $$
declare v_out jsonb;
begin
  if not is_admin() then return null; end if;
  with runs as (
    select r.label, r.finished_at, r.status, r.error, r.result,
           (r.error is null and coalesce(r.status, 200) < 400) as ok,
           (r.error is null and coalesce(r.status, 200) < 400 and not sc_nix_idle(r.result)) as worked
    from job_runs r where r.started_at > now() - interval '24 hours'
  ), per as (
    select label, count(*) runs, count(*) filter (where worked) worked, count(*) filter (where not ok) failed,
           max(finished_at) filter (where not ok) last_failed_at
    from runs group by label
  )
  select jsonb_build_object(
    'generated_at', now(),
    'tasks', (select coalesce(jsonb_agg(jsonb_build_object(
        'name', t.name, 'kind', case when t.steps is null then 'api' else 'db' end,
        'every_min', round(extract(epoch from t.every) / 60), 'max_every_min', round(extract(epoch from t.max_every) / 60),
        'at_time', to_char(t.at_time, 'HH24:MI'), 'only_if', t.only_if is not null,
        'enabled', t.enabled, 'running', t.running_since is not null and t.running_since > now() - interval '30 minutes',
        'next_at', t.next_at, 'last_run_at', t.last_run_at, 'last_ms', t.last_ms,
        'last_idle', t.last_idle, 'idle_runs', t.idle_runs, 'last_result', t.last_result,
        'runs_today', t.runs_today, 'skipped_today', t.skipped_today,
        'runs_24h', coalesce(p.runs, 0), 'worked_24h', coalesce(p.worked, 0), 'failed_24h', coalesce(p.failed, 0),
        'last_failed_at', p.last_failed_at,
        'behind', t.enabled and t.next_at < now() - interval '30 minutes')
      order by t.name), '[]'::jsonb)
      from nix_tasks t left join per p on p.label = t.name),
    'calendar', (select coalesce(jsonb_agg(jsonb_build_object(
        'name', j.jobname, 'schedule', j.schedule, 'active', j.active,
        'last_run', (select max(d.start_time) from cron.job_run_details d where d.jobid = j.jobid),
        'last_status', (select d.status from cron.job_run_details d where d.jobid = j.jobid order by d.start_time desc limit 1))
      order by j.jobname), '[]'::jsonb)
      from cron.job j),
    'activity', (select coalesce(jsonb_agg(x order by x->>'at' desc), '[]'::jsonb) from (
        select jsonb_build_object('name', label, 'at', finished_at, 'result', left(runs.result, 300)) x
        from runs where worked order by finished_at desc limit 60) s),
    'failures', (select coalesce(jsonb_agg(x order by x->>'at' desc), '[]'::jsonb) from (
        select jsonb_build_object('name', label, 'at', finished_at, 'error', left(coalesce(runs.error, runs.result, ''), 300)) x
        from runs where not ok order by finished_at desc limit 25) s),
    'fixes', (select coalesce(jsonb_agg(x order by x->>'at' desc), '[]'::jsonb) from (
        select jsonb_build_object('at', b.created_at, 'label', coalesce(b.label, b.kind), 'kind', b.kind,
          'undone', b.undone_at is not null,
          'changes', (select count(*) from change_log l where l.batch_id = b.id)) x
        from change_batches b
        where b.created_by is null and b.undo_of is null and b.created_at > now() - interval '7 days'
        order by b.created_at desc limit 25) s),
    'totals', (select jsonb_build_object('runs', count(*), 'worked', count(*) filter (where worked),
        'failed', count(*) filter (where not ok)) from runs)
  ) into v_out;
  return v_out;
end $$;
revoke all on function public.admin_nix() from public, anon;
grant execute on function public.admin_nix() to authenticated;

-- Owner: pause, resume, or run a task now.
create or replace function public.admin_nix_set(p_name text, p_action text)
returns boolean language plpgsql security definer set search_path to 'public' as $$
begin
  if not is_owner() then raise exception 'owner only'; end if;
  if p_action = 'pause' then
    update nix_tasks set enabled = false where name = p_name;
  elsif p_action = 'resume' then
    update nix_tasks set enabled = true, next_at = least(next_at, now() + every) where name = p_name;
  elsif p_action = 'run' then
    update nix_tasks set enabled = true, next_at = now(), idle_runs = 0 where name = p_name;
  else
    raise exception 'unknown action';
  end if;
  return found;
end $$;
revoke all on function public.admin_nix_set(text, text) from public, anon;
grant execute on function public.admin_nix_set(text, text) to authenticated;

-- Background check: also tell admins when NIX falls behind on a task.
do $$
declare d text := pg_get_functiondef('public.sc_background_check'::regproc);
declare anchor text := '  return v_failed;';
begin
  if position('nix_tasks' in d) > 0 then return; end if;
  if position(anchor in d) = 0 then raise exception 'anchor missing'; end if;
  d := replace(d, anchor, $add$
  select string_agg(name, ', ' order by name) into v_stuck
  from nix_tasks where enabled and next_at < now() - interval '30 minutes';
  if v_stuck is not null then
    insert into notifications (user_id, kind, title, body, link, dedupe_key)
    select a, 'admin', 'NIX is behind', 'Overdue by more than 30 minutes: ' || v_stuck || '.',
           '/nix', 'nixbehind:' || to_char(now(), 'YYYY-MM-DD HH24')
    from sc_admin_ids(false) a on conflict do nothing;
  end if;
  return v_failed;$add$);
  execute d;
end $$;
