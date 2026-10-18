-- Spotify blocked us for ~21 hours on 18 Oct at 22:38 while the guest
-- artist check was running (it can make up to ~30 Spotify calls a run on top
-- of link matching). Halve it: 4 guests every 20 minutes instead of 8 every
-- 10. Together the Spotify jobs now make roughly 3-4 calls a minute.
select cron.unschedule('guest-artists') where exists (select 1 from cron.job where jobname = 'guest-artists');
select cron.schedule('guest-artists', '8-59/20 * * * *', $job$
  select net.http_post(
    url := 'https://pcuyzaamcsegblrauxsa.supabase.co/functions/v1/guest-artists',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select value from public.sc_private_settings where key = 'cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000);
$job$);
select jobname, schedule from cron.job where jobname = 'guest-artists';
