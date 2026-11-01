-- Use the services' allowances properly (last 24 h before this: Last.fm 11
-- calls of 10,000 a day, Deezer 4,736 of 500,000; Genius and YouTube search
-- already at their limits; Spotify held back by Spotify itself).
--
-- 1. Last.fm import: up to 30 artists an hour (every 2 minutes) instead of
--    6 (and hourly runs), so a full pass takes about a day, not a week.
--    The per-hour number is a setting: import_<source>_per_hour.
-- 2. Deezer: artists' release lists are re-read weekly (was monthly), the
--    job runs every minute (deezer-sync edge function), and song lengths
--    from Deezer are kept (tracks.length_sec, only where empty). Every
--    release is read once more to fill in lengths for songs already linked.

insert into sc_private_settings (key, value) values
  ('import_genius_per_hour', '6'),
  ('import_lastfm_per_hour', '30')
on conflict (key) do nothing;

do $$
declare
  d text;
begin
  -- 1. The import's hourly limit comes from the setting.
  d := pg_get_functiondef('public.sc_scheduled_import_next(text, text)'::regprocedure);
  if position('_per_hour' in d) = 0 then
    d := replace(d, 'if v_used >= 6 then',
      'if v_used >= coalesce((select nullif(value, '''')::int from sc_private_settings where key = ''import_'' || p_source || ''_per_hour''), 6) then');
    if position('_per_hour' in d) = 0 then raise exception 'could not update sc_scheduled_import_next'; end if;
    execute d;
  end if;

  -- 2a. Release lists re-read weekly.
  d := pg_get_functiondef('public.sc_deezer_next(text)'::regprocedure);
  if position('a.deezer_listed_at < now() - interval ''30 days''' in d) > 0 then
    d := replace(d, 'a.deezer_listed_at < now() - interval ''30 days''', 'a.deezer_listed_at < now() - interval ''7 days''');
    execute d;
  end if;

  -- 2b. Song lengths from Deezer, only where empty.
  d := pg_get_functiondef('public.sc_deezer_album_save(text, text, text, jsonb)'::regprocedure);
  if position('length_sec' in d) = 0 then
    d := replace(d, '        cover_url = coalesce(t.cover_url, al.cover),',
                    E'        cover_url = coalesce(t.cover_url, al.cover),\n        length_sec = coalesce(t.length_sec, nullif(it ->> ''duration'', '''')::int),');
    d := replace(d, '        and (t.deezer_url is null or t.album is null or t.release_date is null or t.cover_url is null',
                    E'        and (t.deezer_url is null or t.album is null or t.release_date is null or t.cover_url is null\n             or (t.length_sec is null and nullif(it ->> ''duration'', '''') is not null)');
    d := replace(d, '                        deezer_url, source, source_url)',
                    '                        deezer_url, source, source_url, length_sec)');
    d := replace(d, '            nullif(it ->> ''link'', ''''), ''deezer'', coalesce(nullif(it ->> ''link'', ''''), al.link));',
                    '            nullif(it ->> ''link'', ''''), ''deezer'', coalesce(nullif(it ->> ''link'', ''''), al.link), nullif(it ->> ''duration'', '''')::int);');
    if (length(d) - length(replace(d, 'length_sec', ''))) / length('length_sec') < 4 then
      raise exception 'could not update sc_deezer_album_save';
    end if;
    execute d;
  end if;
end $$;

-- Last.fm import every 2 minutes.
select cron.alter_job(jobid, schedule := '*/2 * * * *') from cron.job where jobname = 'lastfm-import';

-- Read every release once more, for the song lengths (about 47,000 calls:
-- most of a day at normal pace).
update deezer_albums set fetched_at = null, claimed_at = null where fetched_at is not null;
