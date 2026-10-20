-- Last.fm import on a timer: one artist an hour (at :41), same queue and
-- weekly rule as the Genius timer. Finds go to the import review list.
-- Already applied live on 20 Oct 2026; safe to run again (same name updates).
select cron.schedule('lastfm-import', '41 * * * *', $$
  select net.http_post(
    url := 'https://pcuyzaamcsegblrauxsa.supabase.co/functions/v1/import-artist',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select value from public.sc_private_settings where key = 'cron_secret')),
    body := '{"source":"lastfm"}'::jsonb,
    timeout_milliseconds := 120000);
$$);
