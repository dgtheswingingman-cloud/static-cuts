-- Timers no longer wait on each other. The database sends timer calls in
-- batches and waits for the slowest call in a batch, so one long job (the
-- hourly sheet sync, up to 5 minutes) held up every other timer, and calls
-- then piled up and ran two at a time. Every timer now calls run-job, which
-- answers at once and runs the job in the background, recording what it
-- said in job_runs. The background check and Control room read job_runs.

create table if not exists job_runs (
  id bigint generated always as identity primary key,
  job text not null,
  label text,
  started_at timestamptz not null,
  finished_at timestamptz not null default now(),
  status integer,
  result text,
  error text
);
create index if not exists job_runs_started_idx on job_runs (started_at);
alter table job_runs enable row level security;
revoke all on job_runs from anon, authenticated;

-- Point every timer that calls a job at run-job (same job, same body).
do $$
declare
  j record;
  v_fn text;
  v_body text;
begin
  for j in select jobid, jobname, command from cron.job
           where command like '%/functions/v1/%' and command not like '%/functions/v1/run-job%' loop
    v_fn := substring(j.command from '/functions/v1/([A-Za-z0-9_-]+)');
    v_body := coalesce(substring(j.command from 'body := ''([^'']*)''::jsonb'), '{}');
    perform cron.alter_job(j.jobid, command := format($c$
  select net.http_post(
    url := 'https://pcuyzaamcsegblrauxsa.supabase.co/functions/v1/run-job',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select value from public.sc_private_settings where key = 'cron_secret')),
    body := jsonb_build_object('fn', %L, 'body', %L::jsonb),
    timeout_milliseconds := 15000);
$c$, v_fn, v_body));
  end loop;
end $$;

-- Control room: failed background calls, from the jobs' own answers.
create or replace function admin_background_failures()
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'net'
as $$
  select case when is_admin() then jsonb_build_object(
    'calls_6h', (select count(*) from job_runs where started_at > now() - interval '6 hours'),
    'failed_6h', (select count(*) from job_runs
                  where started_at > now() - interval '6 hours' and (status is null or status >= 400 or error is not null)),
    'last_error', (select left(coalesce(error, result, ''), 200) from job_runs
                   where status is null or status >= 400 or error is not null order by started_at desc limit 1))
  end;
$$;

-- Hourly check: the same, plus calls to run-job itself that failed.
create or replace function sc_background_check()
returns integer
language plpgsql
security definer
set search_path to 'public', 'net'
as $$
declare
  v_failed int;
  v_err text;
  v_stuck text;
  v_cron_failed text;
begin
  -- Jobs that failed, or calls that never got through. "JWT issued at
  -- future" is a brief clock hiccup on Supabase's side: not worth an alert.
  select count(*), left(max(e), 200) into v_failed, v_err
  from (
    select job || ': ' || coalesce(error, result, '') as e from job_runs
    where started_at > now() - interval '1 hour' and (status is null or status >= 400 or error is not null)
      and coalesce(result, '') not like '%JWT issued at future%'
    union all
    select coalesce(error_msg, content::text, '') from net._http_response
    where created > now() - interval '1 hour' and (timed_out or status_code >= 400 or error_msg is not null)
  ) x;
  if v_failed >= 3 then  -- 1 or 2 one-off failures: no alert
    insert into notifications (user_id, kind, title, body, link, dedupe_key)
    select a, 'admin', v_failed || ' background job call' || case when v_failed = 1 then '' else 's' end || ' failed in the last hour',
           v_err, '/admin/health', 'bg:' || to_char(now(), 'YYYY-MM-DD HH24')
    from sc_admin_ids(false) a
    on conflict do nothing;
  end if;

  -- Timers that have stopped running: hourly-or-faster ones after 3 hours,
  -- daily ones after 26 hours, monthly ones after 32 days.
  select string_agg(j.jobname, ', ' order by j.jobname) into v_stuck
  from cron.job j
  join lateral (select max(d.start_time) last_run from cron.job_run_details d where d.jobid = j.jobid) r on true
  where j.active and r.last_run is not null
    and r.last_run < now() - case
      when split_part(j.schedule, ' ', 3) <> '*' then interval '32 days'
      when split_part(j.schedule, ' ', 2) = '*' or split_part(j.schedule, ' ', 2) like '%/%' then interval '3 hours'
      else interval '26 hours' end;
  if v_stuck is not null then
    insert into notifications (user_id, kind, title, body, link, dedupe_key)
    select a, 'admin', 'A timer has stopped running',
           'Not run for longer than usual: ' || v_stuck || '. Check the health page.',
           '/admin/health', 'stuck:' || to_char(now(), 'YYYY-MM-DD') || ':' || v_stuck
    from sc_admin_ids(false) a
    on conflict do nothing;
  end if;

  -- Timers whose own database step failed.
  select string_agg(distinct j.jobname, ', ') into v_cron_failed
  from cron.job_run_details d join cron.job j on j.jobid = d.jobid
  where d.start_time > now() - interval '1 hour' and d.status = 'failed';
  if v_cron_failed is not null then
    insert into notifications (user_id, kind, title, body, link, dedupe_key)
    select a, 'admin', 'A timer failed in the last hour', 'Failed: ' || v_cron_failed || '.',
           '/admin/health', 'cronfail:' || to_char(now(), 'YYYY-MM-DD HH24')
    from sc_admin_ids(false) a
    on conflict do nothing;
  end if;

  return v_failed;
end;
$$;
