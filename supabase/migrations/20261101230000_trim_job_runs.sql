-- Keep 3 days of job_runs (the jobs' answers), like the timer history.
create or replace function sc_cron_history_trim()
returns integer
language plpgsql
security definer
set search_path to 'public', 'cron'
as $$
declare
  v_n int;
begin
  delete from cron.job_run_details where end_time < now() - interval '3 days';
  get diagnostics v_n = row_count;
  delete from job_runs where started_at < now() - interval '3 days';
  return v_n;
end;
$$;
revoke execute on function sc_cron_history_trim() from public, anon, authenticated;
