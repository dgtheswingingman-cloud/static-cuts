-- Spotify link matching runs by itself, like the Genius jobs.
--
--   spotify-match   every 5 minutes, 10 songs: finds Spotify links for songs
--                   that have none (about 2,900 songs a day)
--   spotify-verify  every hour, 10 songs: re-checks existing links, oldest
--                   check first, and clears ones Spotify has removed
--
-- If Spotify asks us to slow down, every Spotify job (these two, guest
-- artists and the link tools page) pauses until the time Spotify gives, at
-- least 10 minutes (sc_private_settings 'spotify_pause_until'). The link
-- tools page stays as a "go faster now" option.

select cron.unschedule(jobname) from cron.job where jobname in ('spotify-match', 'spotify-verify');

select cron.schedule('spotify-match', '1-59/5 * * * *', $job$
  select net.http_post(
    url := 'https://pcuyzaamcsegblrauxsa.supabase.co/functions/v1/match-spotify?limit=10',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000);
$job$);

select cron.schedule('spotify-verify', '24 * * * *', $job$
  select net.http_post(
    url := 'https://pcuyzaamcsegblrauxsa.supabase.co/functions/v1/verify-spotify-links?limit=10',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000);
$job$);

select jobname, schedule from cron.job where jobname like 'spotify-%' order by jobname;
