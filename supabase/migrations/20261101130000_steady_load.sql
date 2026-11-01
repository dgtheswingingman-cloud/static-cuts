-- 1 Nov 07:00-15:13 most background timers failed ("job startup timeout"):
-- the database was overloaded and couldn't start them. The release radar
-- rebuild (every 2 minutes, 30 s-4 min each under load) and Deezer's two
-- workers were the extra load added that night. Radar now rebuilds every
-- 10 minutes, one at a time, only when songs changed (or every 30 minutes);
-- Deezer is back to one worker (deezer-sync).

create or replace function sc_release_radar_refresh()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- One at a time, and only when songs changed (or every 30 minutes).
  if not pg_try_advisory_xact_lock(hashtext('sc_release_radar_refresh')) then return; end if;
  if not sc_job_due('radar', interval '30 minutes') then return; end if;
  insert into home_cache (key, data, refreshed_at) values ('radar', sc_release_radar_live(), now())
  on conflict (key) do update set data = excluded.data, refreshed_at = excluded.refreshed_at;
end;
$$;
select cron.alter_job(jobid, schedule := '1-59/10 * * * *') from cron.job where jobname = 'radar-cache';
