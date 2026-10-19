-- One shared Spotify allowance, so the jobs together can never go over
-- Spotify's limits (we were blocked for ~21 hours on 18 Oct).
--
-- Every Spotify call by every job (link matching, link checking, guest
-- artists, "import songs from Spotify") first asks sc_spotify_allow() for a
-- ticket. At most 15 calls a minute and 3,000 a day in total, whoever asks.
-- When it's used up a job stops early and carries on next run. Change the
-- limits with:
--   update sc_private_settings set value = '20' where key = 'spotify_per_minute';
--   update sc_private_settings set value = '4000' where key = 'spotify_per_day';

create table if not exists api_budget (
  service text not null,
  minute timestamptz not null,
  calls int not null default 0,
  primary key (service, minute)
);
alter table api_budget enable row level security;
revoke all on api_budget from anon, authenticated;

insert into sc_private_settings (key, value) values ('spotify_per_minute', '15'), ('spotify_per_day', '3000')
on conflict (key) do nothing;

-- Ask for up to p_want calls; returns how many may be made right now (0
-- while Spotify has asked us to pause).
create or replace function sc_spotify_allow(p_want int)
returns int
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  per_min int := coalesce((select value::int from sc_private_settings where key = 'spotify_per_minute'), 15);
  per_day int := coalesce((select value::int from sc_private_settings where key = 'spotify_per_day'), 3000);
  pause_until text := (select value from sc_private_settings where key = 'spotify_pause_until');
  this_min timestamptz := date_trunc('minute', now());
  used_min int;
  used_day int;
  give int;
begin
  if p_want is null or p_want < 1 then return 0; end if;
  if pause_until is not null and pause_until::timestamptz > now() then return 0; end if;
  -- One caller at a time, so two jobs can't both take the last tickets.
  perform pg_advisory_xact_lock(hashtext('spotify_budget'));
  select coalesce(sum(calls), 0) into used_min from api_budget where service = 'spotify' and minute = this_min;
  select coalesce(sum(calls), 0) into used_day from api_budget where service = 'spotify' and minute > now() - interval '24 hours';
  give := greatest(0, least(p_want, per_min - used_min, per_day - used_day));
  if give > 0 then
    insert into api_budget (service, minute, calls) values ('spotify', this_min, give)
    on conflict (service, minute) do update set calls = api_budget.calls + excluded.calls;
  end if;
  return give;
end;
$$;
revoke execute on function sc_spotify_allow(int) from public, anon, authenticated;
grant execute on function sc_spotify_allow(int) to service_role;

-- Old counts are cleared by the hourly background check.
create or replace function sc_api_budget_tidy()
returns void
language sql
security definer
set search_path to 'public'
as $$
  delete from api_budget where minute < now() - interval '3 days';
$$;
revoke execute on function sc_api_budget_tidy() from public, anon, authenticated;
select cron.unschedule('api-budget-tidy') where exists (select 1 from cron.job where jobname = 'api-budget-tidy');
select cron.schedule('api-budget-tidy', '15 4 * * *', $job$ select public.sc_api_budget_tidy(); $job$);

-- For the health page.
create or replace function admin_spotify_budget()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select case when is_admin() then jsonb_build_object(
    'today', (select coalesce(sum(calls), 0) from api_budget where service = 'spotify' and minute > now() - interval '24 hours'),
    'last_hour', (select coalesce(sum(calls), 0) from api_budget where service = 'spotify' and minute > now() - interval '1 hour'),
    'per_day', coalesce((select value::int from sc_private_settings where key = 'spotify_per_day'), 3000),
    'per_minute', coalesce((select value::int from sc_private_settings where key = 'spotify_per_minute'), 15)
  ) end;
$$;
revoke execute on function admin_spotify_budget() from public, anon;
grant execute on function admin_spotify_budget() to authenticated;

select key, value from sc_private_settings where key in ('spotify_per_minute', 'spotify_per_day') order by key;
