-- Checks review fixes (11 Nov 2026).
--
-- 1. Credits trigger only runs when a credited field actually changes. It ran
--    on every update that merely set title/producers/features (sheet syncs
--    re-set them on every row), which pushed big sheet syncs (SosMula) past
--    the time limit since 9 Nov.
-- 2. Jobs that have run out of work most of the time are called less often
--    (they were called every 1-2 minutes to do nothing):
--      apple-music, deezer-sync (search is off): every 5 min
--      version-ai: every 10 min
-- 3. Possible editions (from 11 Nov): its nightly timer.
drop trigger if exists tracks_people_sync on tracks;
create trigger tracks_people_sync after insert on tracks
  for each row execute function sc_track_people_sync();
create trigger tracks_people_sync_update after update of title, producers, featured_artists, artist_id on tracks
  for each row when (old.title is distinct from new.title or old.producers is distinct from new.producers
                     or old.featured_artists is distinct from new.featured_artists or old.artist_id is distinct from new.artist_id)
  execute function sc_track_people_sync();

select cron.alter_job(jobid, schedule := '*/5 * * * *') from cron.job where jobname in ('apple-music', 'deezer-sync');
select cron.alter_job(jobid, schedule := '*/10 * * * *') from cron.job where jobname = 'version-ai';
