-- Genius imports have been stuck as "running" since 31 Oct 16:50 (the
-- 9 failed background calls alert). Genius's day allowance was used up by
-- the extreme run that evening; each import then waited for a ticket until
-- it was cut off, never finishing. Now the import timer doesn't start one
-- while the day's allowance is used up, and the import waits at most one
-- minute for a ticket (import-artist).

create or replace function sc_scheduled_import_next(p_secret text, p_source text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_admin uuid;
  v_used int;
  v_pick text;
  v_claim text := 'timer:' || p_source;
  v_day_used int;
  v_day_max int;
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then
    raise exception 'not authorized';
  end if;
  if p_source not in ('genius', 'lastfm', 'spotify') then raise exception 'unknown source'; end if;
  select id into v_admin from auth.users where email = 'dg.theswingingman@gmail.com';

  -- Nothing left of the service's day allowance: don't start an import
  -- that can only wait.
  if p_source in ('genius', 'lastfm') then
    v_day_max := coalesce((select value::int from sc_private_settings where key = p_source || '_per_day'), 2000);
    select coalesce(sum(calls), 0) into v_day_used from api_budget where service = p_source and minute > now() - interval '24 hours';
    if v_day_used >= v_day_max - 20 then
      return jsonb_build_object('reason', 'day allowance used up');
    end if;
  end if;

  -- One picker at a time per source, and the hourly allowance.
  perform pg_advisory_xact_lock(hashtext('sc_claim_artists:' || v_claim));
  select count(*) into v_used from artist_queue_claims where source = v_claim and claimed_at > now() - interval '1 hour';
  if v_used >= coalesce((select nullif(value, '')::int from sc_private_settings where key = 'import_' || p_source || '_per_hour'), 6) then return jsonb_build_object('reason', 'hourly limit reached'); end if;

  with q as (
    select q.artist_id, q.due, row_number() over () ord
    from sc_artist_queue(5000, false) q
    join artists a on a.id = q.artist_id and not a.catalogue_hold
  ),
  c as (
    select q.*, (select max(r.started_at) from import_runs r where r.artist_id = q.artist_id and r.source = p_source) last_run
    from q
    where not exists (select 1 from artist_queue_claims x where x.source = v_claim and x.artist_id = q.artist_id
                        and x.claimed_at > now() - interval '1 day')
  ),
  ok as (
    select c.*, (c.due and (c.last_run is null or c.last_run < now() - interval '7 days')) as due_now
    from c
    where (c.due and (c.last_run is null or c.last_run < now() - interval '7 days'))
       or c.last_run is null or c.last_run < now() - interval '3 days'
  )
  -- Due first; among those, artists whose existing songs are filled in
  -- first; then the usual queue order. Nobody due: longest since checked.
  select ok.artist_id into v_pick from ok
  order by ok.due_now desc,
           case when ok.due_now then sc_artist_existing_work(ok.artist_id) end,
           case when ok.due_now then ok.ord end,
           ok.last_run nulls first, ok.ord
  limit 1;

  if v_pick is null then
    return jsonb_build_object('reason', 'every artist was checked in the last 3 days');
  end if;
  insert into artist_queue_claims (source, artist_id) values (v_claim, v_pick);
  return jsonb_build_object('artist_id', v_pick, 'user_id', v_admin);
end;
$$;

-- The stuck runs: mark them finished so they can be picked again later.
update import_runs
set finished_at = now(), error = 'Stopped waiting: Genius allowance was used up. It will be tried again.'
where finished_at is null and started_at < now() - interval '15 minutes';
