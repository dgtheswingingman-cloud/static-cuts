-- Allowances per hour, so a service's daily allowance is spread across the
-- day instead of used up in the first couple of hours. Spotify had 600 a day
-- at 4 a minute: all 600 went in ~2.5 hours after midnight UTC, then nothing
-- until the next night. Now also at most 25 an hour (25 x 24 = 600).
-- Any service can get an hourly cap with a '<service>_per_hour' setting;
-- without one, nothing changes.

create or replace function sc_api_allow(p_service text, p_want int)
returns int
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
  used_min int;
  used_hour int := 0;
  used_day int;
  give int;
begin
  if p_service is null or p_service !~ '^[a-z]+$' then raise exception 'unknown service'; end if;
  if p_want is null or p_want < 1 then return 0; end if;
  if pause_until is not null and pause_until::timestamptz > now() then return 0; end if;
  -- One caller at a time per service, so two jobs can't both take the last tickets.
  perform pg_advisory_xact_lock(hashtext(p_service || '_budget'));
  select coalesce(sum(calls), 0) into used_min from api_budget where service = p_service and minute = this_min;
  if per_hour is not null then
    select coalesce(sum(calls), 0) into used_hour from api_budget where service = p_service and minute > now() - interval '1 hour';
  end if;
  select coalesce(sum(calls), 0) into used_day from api_budget where service = p_service and minute > now() - interval '24 hours';
  give := greatest(0, least(p_want, per_min - used_min, coalesce(per_hour, 2147483647) - used_hour, per_day - used_day));
  if give > 0 then
    insert into api_budget (service, minute, calls) values (p_service, this_min, give)
    on conflict (service, minute) do update set calls = api_budget.calls + excluded.calls;
  end if;
  return give;
end;
$$;
revoke execute on function sc_api_allow(text, int) from public, anon, authenticated;

insert into sc_private_settings (key, value) values ('spotify_per_hour', '25')
on conflict (key) do update set value = excluded.value;
