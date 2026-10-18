-- Overnight imports without a computer on.
--
-- A database timer (pg_cron) calls the import-artist function every 10
-- minutes. Each call takes the next artist from the artist queue that
-- hasn't had this import in the last 7 days and runs it, at most 6 artists
-- an hour per source. Genius results wait in the import review list as usual.
--
-- Turn off:   select cron.unschedule('genius-import');
-- Turn on:    run the cron.schedule(...) block at the bottom again.
-- Check:      the health page shows the imports; or
--             select * from cron.job_run_details order by start_time desc limit 10;

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- A random password the timer sends, so nobody else can trigger runs.
create table if not exists sc_private_settings (key text primary key, value text not null);
alter table sc_private_settings enable row level security;
revoke all on sc_private_settings from public, anon, authenticated;
insert into sc_private_settings (key, value)
values ('cron_secret', replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
on conflict (key) do nothing;

-- Called by the import function for a timer run: checks the password and
-- hands back the next artist and the admin's user id.
create or replace function sc_scheduled_import_next(p_secret text, p_source text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_ids text[];
  v_id text;
  v_admin uuid;
  i int := 0;
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then
    raise exception 'not authorized';
  end if;
  if p_source not in ('genius', 'lastfm', 'spotify') then raise exception 'unknown source'; end if;
  select id into v_admin from auth.users where email = 'dg.theswingingman@gmail.com';

  -- Up to 5 tries to find a due artist this source hasn't covered this week.
  while i < 5 loop
    i := i + 1;
    v_ids := sc_claim_artists('timer:' || p_source, 1, 6);
    if v_ids is null or cardinality(v_ids) = 0 then
      return jsonb_build_object('reason', 'hourly limit reached or nothing due');
    end if;
    v_id := v_ids[1];
    if not exists (select 1 from import_runs where artist_id = v_id and source = p_source
                   and error is null and started_at > now() - interval '7 days') then
      return jsonb_build_object('artist_id', v_id, 'user_id', v_admin);
    end if;
  end loop;
  return jsonb_build_object('reason', 'every due artist was imported this week');
end;
$$;
revoke execute on function sc_scheduled_import_next(text, text) from public, anon, authenticated;
grant execute on function sc_scheduled_import_next(text, text) to service_role;

-- The timer. Every 10 minutes, Genius.
select cron.unschedule('genius-import') where exists (select 1 from cron.job where jobname = 'genius-import');
select cron.schedule('genius-import', '*/10 * * * *', $job$
  select net.http_post(
    url := 'https://pcuyzaamcsegblrauxsa.supabase.co/functions/v1/import-artist',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select value from public.sc_private_settings where key = 'cron_secret')),
    body := '{"source":"genius"}'::jsonb,
    timeout_milliseconds := 120000);
$job$);

select jobname, schedule, active from cron.job;
