-- NIX step 3: the in-database jobs run through NIX too, and related ones are merged.
--
-- A task with `steps` runs inside the database (one step after another, each
-- step committed on its own so a slow one never holds the others back, and a
-- failing step doesn't stop the rest). Tasks without steps are the API jobs
-- from step 2 and still go through run-job.
--
-- Merged:
--   caches         artist counts + genres + release radar (all every 10 min)
--   duplicates     find candidates, then auto-merge the sure ones (was two hourly jobs 24 min apart)
--   versions-tidy  clear finished version checks + statuses from versions
--   collab-edges   nightly collaborator rebuild, then the collab cache straight after
--   covers-known   known covers + era covers (already one job)
-- version-rescan only runs when someone has asked for a rescan (was every 2 min).
-- Jobs with nothing to do wait longer (genius-auto-add, title-cleanup, soundcloud-covers).
-- Every run is written to job_runs (job 'sql'), so the NIX page shows them with the API jobs.
-- Weekly / monthly jobs (aotw-shortlist, bio-mixups, contributor-rewards) stay on their calendar timers.

alter table public.nix_tasks alter column fn drop not null;
alter table public.nix_tasks add column if not exists steps jsonb;
alter table public.nix_tasks add column if not exists at_time time;
alter table public.nix_tasks add column if not exists last_ms int;

-- API jobs only.
create or replace function public.sc_nix_tick()
returns int language plpgsql security definer set search_path to 'public' as $$
declare t record; ok boolean; n int := 0; secret text;
begin
  select value into secret from sc_private_settings where key = 'cron_secret';
  update nix_tasks set runs_today = 0, skipped_today = 0, day = current_date where day <> current_date;
  for t in
    select * from nix_tasks
    where enabled and steps is null and next_at <= now()
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

-- The job_runs trigger only handles API jobs; database jobs note their own result.
create or replace function public.sc_nix_job_done()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare idle boolean;
begin
  if new.job = 'sql' then return new; end if;
  begin
    idle := new.error is null and coalesce(new.status, 200) < 400 and sc_nix_idle(new.result);
    update nix_tasks set
      running_since = null,
      last_result = left(coalesce(new.error, new.result), 500),
      last_idle = idle,
      last_ms = (extract(epoch from (new.finished_at - new.started_at)) * 1000)::int,
      idle_runs = case when idle then idle_runs + 1 else 0 end,
      next_at = coalesce(last_run_at, now()) + case
        when idle then least(max_every, every * power(2, least(idle_runs + 1, 10)))
        else every end
    where name = new.label and steps is null;
  exception when others then null;
  end;
  return new;
end $$;

-- Runs due database jobs one at a time for up to ~50 s a minute. A procedure
-- (not security definer, no SET clause) so it can commit after every step.
create or replace procedure public.sc_nix_sql_tick()
language plpgsql as $$
declare
  t record; s jsonb; v text; res jsonb; err text; t0 timestamptz; ok boolean;
  started timestamptz := clock_timestamp(); idle boolean; nxt timestamptz;
begin
  loop
    exit when clock_timestamp() - started > interval '50 seconds';
    select * into t from public.nix_tasks
      where enabled and steps is not null and next_at <= clock_timestamp()
        and (running_since is null or running_since < clock_timestamp() - interval '30 minutes')
      order by next_at limit 1 for update skip locked;
    exit when not found;

    ok := true;
    if t.only_if is not null then
      begin execute 'select (' || t.only_if || ')' into ok;
      exception when others then ok := true; end;
    end if;
    if not coalesce(ok, false) then
      update public.nix_tasks set next_at = clock_timestamp() + every, skipped_today = skipped_today + 1 where name = t.name;
      commit;
      continue;
    end if;

    update public.nix_tasks set running_since = clock_timestamp() where name = t.name;
    commit;

    res := '{}'; err := null; t0 := clock_timestamp();
    for s in select value from jsonb_array_elements(t.steps) loop
      begin
        execute 'select (' || (s ->> 'sql') || ')::text' into v;
        begin
          res := res || jsonb_build_object(s ->> 'name', v::jsonb);
        exception when others then
          res := res || jsonb_build_object(s ->> 'name', v);
        end;
      exception when others then
        err := coalesce(err || '; ', '') || (s ->> 'name') || ': ' || sqlerrm;
      end;
      commit;
    end loop;

    idle := err is null and public.sc_nix_idle(res::text);
    if t.at_time is not null then
      nxt := date_trunc('day', clock_timestamp()) + t.at_time;
      if nxt <= clock_timestamp() + interval '1 minute' then nxt := nxt + interval '1 day'; end if;
    else
      nxt := clock_timestamp() + case
        when idle then least(t.max_every, t.every * power(2, least(t.idle_runs + 1, 10)))
        else t.every end;
    end if;

    update public.nix_tasks set
      running_since = null, last_run_at = t0, next_at = nxt,
      last_result = left(coalesce(err, res::text), 500), last_idle = idle,
      last_ms = (extract(epoch from (clock_timestamp() - t0)) * 1000)::int,
      idle_runs = case when idle then idle_runs + 1 else 0 end,
      runs_today = runs_today + 1
    where name = t.name;
    insert into public.job_runs (job, label, started_at, finished_at, status, result, error)
    values ('sql', t.name, t0, clock_timestamp(), case when err is null then 200 else 500 end, left(res::text, 2000), err);
    commit;
  end loop;
end $$;
revoke all on procedure public.sc_nix_sql_tick() from public, anon, authenticated;

-- name, steps, every, max_every, only_if, at_time (UTC)
insert into public.nix_tasks (name, steps, every, max_every, only_if, at_time) values
  ('home-cache',      '[{"name":"home","sql":"public.sc_home_cache_refresh()"}]', '5 min', '5 min', null, null),
  ('caches',          '[{"name":"artist_counts","sql":"public.sc_refresh_artist_counts()"},{"name":"genres","sql":"public.sc_refresh_genre_cache()"},{"name":"radar","sql":"public.sc_release_radar_refresh()"}]', '10 min', '10 min', null, null),
  ('whats-new-warm',  '[{"name":"week","sql":"public.rpc_whats_new(null, ''all'', false, 7) is not null"},{"name":"three_days","sql":"public.rpc_whats_new(null, ''all'', false, 3) is not null"}]', '9 min', '9 min', null, null),
  ('review-counts',   '[{"name":"counts","sql":"public.sc_refresh_review_counts()"}]', '15 min', '15 min', null, null),
  ('guest-refresh',   '[{"name":"guests","sql":"public.sc_guest_refresh()"}]', '20 min', '20 min', null, null),
  ('artist-growth',   '[{"name":"growth","sql":"public.sc_grow_artists()"}]', '30 min', '30 min', null, null),
  ('background-check','[{"name":"checked","sql":"public.sc_background_check()"}]', '1 hour', '1 hour', null, null),
  ('collab-cache',    '[{"name":"cache","sql":"public.sc_collab_cache_refresh()"}]', '1 hour', '1 hour', null, null),
  ('duplicates',      '[{"name":"candidates","sql":"public.sc_refresh_duplicate_candidates()"},{"name":"merged","sql":"public.sc_duplicate_auto_merge()"}]', '1 hour', '1 hour', null, null),
  ('genius-auto-add', '[{"name":"added","sql":"public.sc_auto_add_genius()"}]', '1 hour', '4 hours', null, null),
  ('prerelease-step', '[{"name":"step","sql":"public.sc_prerelease_step()"}]', '1 hour', '1 hour', null, null),
  ('queue-searched-artists', '[{"name":"queued","sql":"public.sc_queue_searched_artists()"}]', '1 hour', '1 hour', null, null),
  ('versions-tidy',   '[{"name":"cleared","sql":"public.sc_version_auto_clear()"},{"name":"statuses","sql":"public.sc_status_from_versions()"}]', '1 hour', '1 hour', null, null),
  ('title-cleanup',   '[{"name":"cleaned","sql":"public.sc_title_tag_cleanup()"}]', '1 hour', '4 hours', null, null),
  ('top-contributors','[{"name":"top","sql":"public.sc_top_contributors_refresh()"}]', '1 hour', '1 hour', null, null),
  ('visitor-stats',   '[{"name":"stats","sql":"public.sc_visitor_stats_refresh()"}]', '1 hour', '1 hour', null, null),
  ('soundcloud-covers','[{"name":"step","sql":"public.sc_soundcloud_cover_step()"}]', '5 min', '1 hour', null, null),
  ('version-rescan',  '[{"name":"found","sql":"public.sc_version_rescan_run()"}]', '1 min', '1 min',
     'exists (select 1 from public.home_cache where key = ''version_rescan'' and data ->> ''state'' = ''waiting'')', null),
  -- nightly / daily
  ('social-posts',    '[{"name":"built","sql":"public.sc_social_build()"}]', '1 day', '1 day', null, '00:07'),
  ('sitemap',         '[{"name":"urls","sql":"public.sc_sitemap_refresh()"}]', '1 day', '1 day', null, '03:29'),
  ('covers-known',    '[{"name":"known","sql":"public.sc_cover_fill_known()"},{"name":"eras","sql":"public.sc_era_covers_refresh()"}]', '1 day', '1 day', null, '03:41'),
  ('album-track-linking', '[{"name":"linked","sql":"public.sc_album_link_tracks()"}]', '1 day', '1 day', null, '03:53'),
  ('api-budget-tidy', '[{"name":"tidy","sql":"public.sc_api_budget_tidy()"}]', '1 day', '1 day', null, '04:15'),
  ('import-queue-sweep', '[{"name":"dismissed","sql":"public.sc_import_queue_sweep()"}]', '1 day', '1 day', null, '04:17'),
  ('title-checks',    '[{"name":"checks","sql":"public.sc_title_checks_refresh()"}]', '1 day', '1 day', null, '04:23'),
  ('possible-editions','[{"name":"found","sql":"public.sc_find_possible_editions()"}]', '1 day', '1 day', null, '04:27'),
  ('undo-trim',       '[{"name":"trimmed","sql":"public.sc_trim_undo()"}]', '1 day', '1 day', null, '04:35'),
  ('collab-edges',    '[{"name":"edges","sql":"public.sc_refresh_collab_edges()"},{"name":"cache","sql":"public.sc_collab_cache_refresh()"}]', '1 day', '1 day', null, '04:41'),
  ('cron-history-trim','[{"name":"trimmed","sql":"public.sc_cron_history_trim()"}]', '1 day', '1 day', null, '04:47'),
  ('radar-daily',     '[{"name":"sent","sql":"public.sc_radar_daily()"}]', '1 day', '1 day', null, '07:05'),
  ('follow-digest',   '[{"name":"sent","sql":"public.sc_follow_digest()"}]', '1 day', '1 day', null, '07:07')
on conflict (name) do nothing;

-- First runs: daily ones at their time, the rest spread over the next few minutes.
update public.nix_tasks set next_at = case
    when at_time is not null then
      case when date_trunc('day', now()) + at_time > now() then date_trunc('day', now()) + at_time
           else date_trunc('day', now()) + at_time + interval '1 day' end
    else now() + random() * least(every, interval '5 minutes') end
where steps is not null and last_run_at is null;

select cron.unschedule(jobname) from cron.job where jobname in (
  'home-cache','artist-counts-refresh','genre-cache','radar-cache','whats-new-warm','review-counts','guest-refresh',
  'artist-growth','background-check','collab-cache','duplicate-refresh','duplicate-auto-merge','genius-auto-add',
  'prerelease-step','queue-searched-artists','version-auto-clear','status-from-versions','title-cleanup',
  'top-contributors','visitor-stats','soundcloud-covers','version-rescan','social-posts','sitemap-refresh',
  'covers-known','album-track-linking','api-budget-tidy','import-queue-sweep','title-checks','possible-editions',
  'undo-trim','collab-refresh','cron-history-trim','radar-daily','follow-digest');
select cron.schedule('nix-sql-tick', '* * * * *', $$call public.sc_nix_sql_tick()$$);
