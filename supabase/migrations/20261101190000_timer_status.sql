-- Control room timers: how each is doing now, not just "N failed today"
-- (a bad hour this morning made every timer look broken all day). Adds
-- runs in the last 24 hours, failures in the last hour and the latest
-- error in short. Reads the timer log once instead of three times a timer.

create or replace function admin_timers()
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'cron'
as $$
  with d as (
    select jobid,
           count(*) as runs_24h,
           count(*) filter (where status <> 'succeeded' and status <> 'running') as failed_24h,
           count(*) filter (where status <> 'succeeded' and status <> 'running' and start_time > now() - interval '1 hour') as failed_1h,
           max(start_time) as last_run
    from cron.job_run_details
    where start_time > now() - interval '24 hours'
    group by jobid
  ),
  latest as (
    select distinct on (jobid) jobid, status, return_message
    from cron.job_run_details
    where start_time > now() - interval '24 hours'
    order by jobid, start_time desc
  )
  select case when is_admin() then (
    select coalesce(jsonb_agg(jsonb_build_object(
      'name', j.jobname, 'schedule', j.schedule, 'active', j.active,
      'last_run', d.last_run,
      'last_status', l.status,
      'runs_24h', coalesce(d.runs_24h, 0),
      'failed_24h', coalesce(d.failed_24h, 0),
      'failed_1h', coalesce(d.failed_1h, 0),
      'last_error', case when l.status not in ('succeeded', 'running')
                         then left(regexp_replace(split_part(coalesce(l.return_message, ''), E'\n', 1), '^ERROR:\s*', ''), 120) end)
      order by j.jobname), '[]'::jsonb)
    from cron.job j left join d on d.jobid = j.jobid left join latest l on l.jobid = j.jobid) end;
$$;
