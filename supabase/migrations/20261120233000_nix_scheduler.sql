-- NIX consolidation, step 2 (Nathan, 20 Nov): one scheduler instead of 27
-- timers that each woke a background job every 1-15 minutes (~9,000 wake-ups
-- a day, most finding nothing to do).
--
-- nix_tasks lists each job, its normal pace (every) and its slowest pace
-- (max_every). Once a minute sc_nix_tick() starts the tasks that are due,
-- through the same run-job doorway as before. When a job reports it found
-- nothing, its next run waits twice as long (up to max_every); as soon as it
-- finds work it's back to its normal pace. A task with an only_if check is
-- skipped without any call when that check says there's nothing waiting.

create table if not exists public.nix_tasks (
  name text primary key,            -- = job_runs.label ("song-check:deezer")
  fn text not null,
  body jsonb not null default '{}',
  every interval not null,
  max_every interval not null,
  only_if text,                     -- optional SQL condition (true = there is work)
  enabled boolean not null default true,
  next_at timestamptz not null default now(),
  idle_runs int not null default 0,
  running_since timestamptz,
  last_run_at timestamptz,
  last_result text,
  last_idle boolean,
  runs_today int not null default 0,
  skipped_today int not null default 0,
  day date not null default current_date
);
alter table public.nix_tasks enable row level security;

-- Did the job find nothing to do? Its reply says so ("idle": true), or it
-- has no number above zero and no non-empty list anywhere in it. Errors and
-- unreadable replies count as not idle (so they're retried at normal pace).
create or replace function public.sc_nix_idle(p text)
returns boolean language plpgsql immutable as $$
declare j jsonb;
begin
  if p is null then return false; end if;
  begin j := p::jsonb; exception when others then return false; end;
  if jsonb_typeof(j) <> 'object' or j ? 'error' then return false; end if;
  if (j->>'idle') = 'true' then return true; end if;
  return not jsonb_path_exists(j, '$.** ? (@.type() == "number" && @ > 0)')
     and not jsonb_path_exists(j, '$.** ? (@.type() == "array" && @.size() > 0)');
end $$;

create or replace function public.sc_nix_tick()
returns int language plpgsql security definer set search_path to 'public' as $$
declare t record; ok boolean; n int := 0; secret text;
begin
  select value into secret from sc_private_settings where key = 'cron_secret';
  update nix_tasks set runs_today = 0, skipped_today = 0, day = current_date where day <> current_date;
  for t in
    select * from nix_tasks
    where enabled and next_at <= now()
      and (running_since is null or running_since < now() - interval '10 minutes')
    order by next_at limit 25
  loop
    ok := true;
    if t.only_if is not null then
      begin execute 'select (' || t.only_if || ')' into ok;
      exception when others then ok := true; end;
    end if;
    if not coalesce(ok, false) then
      update nix_tasks set next_at = now() + every, skipped_today = skipped_today + 1 where name = t.name;
      continue;
    end if;
    perform net.http_post(
      url := 'https://pcuyzaamcsegblrauxsa.supabase.co/functions/v1/run-job',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
      body := jsonb_build_object('fn', t.fn, 'body', t.body),
      timeout_milliseconds := 15000);
    update nix_tasks set running_since = now(), last_run_at = now(), next_at = now() + every,
      runs_today = runs_today + 1 where name = t.name;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.sc_nix_tick() from public, anon, authenticated;

-- When a job finishes (run-job writes job_runs), pace its next run.
create or replace function public.sc_nix_job_done()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare idle boolean;
begin
  begin
    idle := new.error is null and coalesce(new.status, 200) < 400 and sc_nix_idle(new.result);
    update nix_tasks set
      running_since = null,
      last_result = left(coalesce(new.error, new.result), 500),
      last_idle = idle,
      idle_runs = case when idle then idle_runs + 1 else 0 end,
      next_at = coalesce(last_run_at, now()) + case
        when idle then least(max_every, every * power(2, least(idle_runs + 1, 10)))
        else every end
    where name = new.label;
  exception when others then null; -- pacing must never lose a job_runs row
  end;
  return new;
end $$;
drop trigger if exists nix_job_done on public.job_runs;
create trigger nix_job_done after insert on public.job_runs for each row execute function public.sc_nix_job_done();

-- The tasks (same jobs, bodies and checks the old timers had).
insert into public.nix_tasks (name, fn, body, every, max_every, only_if) values
  ('aotw-blurb',            'aotw-blurb',           '{}', '10 min', '1 hour',  'exists (select 1 from public.aotw_candidates c where not c.retired and c.blurb is null and c.week_start >= current_date - 7)'),
  ('apple-music',           'apple-music',          '{}', '5 min',  '1 hour',  null),
  ('artist-info',           'artist-info',          '{}', '30 min', '2 hours', null),
  ('artist-photos',         'artist-photos',        '{}', '3 min',  '30 min',  'exists (select 1 from public.artists a where a.photos_checked_at is null or a.photos_checked_at < now() - interval ''60 days'')'),
  ('cover-copy',            'cover-copy',           '{}', '2 min',  '30 min',  'exists (select 1 from public.cover_suggestions where status = ''approved'')'),
  ('cover-search',          'cover-search',         '{}', '2 min',  '30 min',  null),
  ('deezer-fans',           'deezer-fans',          '{}', '10 min', '1 hour',  null),
  ('deezer-sync',           'deezer-sync',          '{}', '5 min',  '1 hour',  null),
  ('discogs-sync',          'discogs-sync',         '{}', '5 min',  '1 hour',  null),
  ('discord',               'discord',              '{"mode":"post"}', '2 min', '2 min', 'exists (select 1 from public.discord_alert_queue q where q.sent_at is null) or public.sc_discord_daily_due()'),
  ('fetch-covers',          'fetch-covers',         '{}', '10 min', '1 hour',  null),
  ('genius-credits',        'genius-credits',       '{}', '1 min',  '1 min',   null),
  ('import-artist:genius',  'import-artist',        '{"source":"genius"}', '10 min', '1 hour', null),
  ('guest-artists',         'guest-artists',        '{}', '10 min', '1 hour',  null),
  ('import-artist:lastfm',  'import-artist',        '{"source":"lastfm"}', '2 min', '30 min', null),
  ('check-links',           'check-links',          '{}', '30 min', '2 hours', null),
  ('listenbrainz-sync',     'listenbrainz-sync',    '{}', '5 min',  '1 hour',  null),
  ('musicbrainz-sync',      'musicbrainz-sync',     '{}', '2 min',  '1 hour',  null),
  ('send-push',             'send-push',            '{}', '2 min',  '2 min',   null),
  ('sheet-import',          'sheet-import',         '{"action":"sync"}', '1 hour', '1 hour', null),
  ('song-check:apple',      'song-check',           '{"service":"apple","source":"apple"}', '3 min', '30 min', null),
  ('song-check:deezer',     'song-check',           '{"service":"deezer","source":"deezer"}', '2 min', '30 min', null),
  ('match-spotify',         'match-spotify',        '{}', '5 min',  '1 hour',  null),
  ('verify-spotify-links',  'verify-spotify-links', '{}', '1 hour', '1 hour',  null),
  ('version-ai',            'version-ai',           '{}', '10 min', '1 hour',  null),
  ('wikipedia-sync',        'wikipedia-sync',       '{}', '5 min',  '1 hour',  null),
  ('youtube-search',        'youtube-search',       '{}', '15 min', '1 hour',  null)
on conflict (name) do nothing;

-- Spread the first runs over a few minutes instead of all at once.
update public.nix_tasks set next_at = now() + (random() * interval '5 minutes');

-- The old timers go; one NIX tick replaces them.
select cron.unschedule(jobname) from cron.job where jobname in (
  'aotw-blurb','apple-music','artist-info','artist-photos','cover-copy','cover-search','deezer-fans','deezer-sync',
  'discogs-sync','discord-alerts','fetch-covers','genius-credits','genius-import','guest-artists','lastfm-import',
  'link-check','listenbrainz-sync','musicbrainz-sync','push-alerts','sheet-sync','song-check-apple','song-check-deezer',
  'spotify-match','spotify-verify','version-ai','wikipedia-sync','youtube-search');
select cron.schedule('nix-tick', '* * * * *', $$select public.sc_nix_tick()$$);
