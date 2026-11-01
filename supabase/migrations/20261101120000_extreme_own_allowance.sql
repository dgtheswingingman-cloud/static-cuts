-- Genius extreme mode used up the normal 24-hour allowance, so Genius sat
-- idle for a day afterwards (31 Oct 16:45 - 1 Nov 16:45). Calls made while
-- extreme is on are now counted separately ("geniusmax"): they still count
-- towards the per-minute limit, but not the day's allowance, so normal
-- work carries on as soon as extreme ends.

create or replace function sc_api_allow(p_service text, p_want integer)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  per_min int := coalesce((select value::int from sc_private_settings where key = p_service || '_per_minute'), 20);
  per_hour int := (select value::int from sc_private_settings where key = p_service || '_per_hour');
  per_day int := coalesce((select value::int from sc_private_settings where key = p_service || '_per_day'), 2000);
  pause_until text := (select value from sc_private_settings where key = p_service || '_pause_until');
  this_min timestamptz := date_trunc('minute', now());
  extreme boolean;
  bucket text := p_service;
  used_min int;
  used_hour int := 0;
  used_day int := 0;
  give int;
begin
  if p_service is null or p_service !~ '^[a-z]+$' then raise exception 'unknown service'; end if;
  if p_want is null or p_want < 1 then return 0; end if;
  if pause_until is not null and pause_until::timestamptz > now() then return 0; end if;
  extreme := coalesce((select value from sc_private_settings where key = p_service || '_pace'), '') = 'max'
         and coalesce(nullif((select value from sc_private_settings where key = p_service || '_extreme_until'), '')::timestamptz, now()) > now();
  if extreme then bucket := p_service || 'max'; end if;
  -- One caller at a time per service, so two jobs can't both take the last tickets.
  perform pg_advisory_xact_lock(hashtext(p_service || '_budget'));
  select coalesce(sum(calls), 0) into used_min from api_budget where service in (p_service, p_service || 'max') and minute = this_min;
  if per_hour is not null then
    select coalesce(sum(calls), 0) into used_hour from api_budget where service = p_service and minute > now() - interval '1 hour';
  end if;
  if not extreme then
    select coalesce(sum(calls), 0) into used_day from api_budget where service = p_service and minute > now() - interval '24 hours';
  end if;
  give := greatest(0, least(p_want, per_min - used_min, coalesce(per_hour, 2147483647) - used_hour,
                            case when extreme then 2147483647 else per_day - used_day end));
  if give > 0 then
    insert into api_budget (service, minute, calls) values (bucket, this_min, give)
    on conflict (service, minute) do update set calls = api_budget.calls + excluded.calls;
  end if;
  return give;
end;
$$;

-- Yesterday's extreme run (31 Oct, until 18:49) moved to its own count, so
-- Genius can start again now instead of at 16:45 today.
update api_budget set service = 'geniusmax'
where service = 'genius'
  and minute >= '2026-10-31 14:30+00' and minute <= '2026-10-31 18:50+00';
