-- The owner's routine hit the 100-findings-a-day cap on big catch-up runs.
-- Owner: 500 a day; everyone else stays at 100.
create or replace function sc_discovery_daily_limit(p_uid uuid)
returns int language sql stable security definer set search_path to 'public' as $f$
  select case when exists (select 1 from auth.users u where u.id = p_uid and u.email = 'dg.theswingingman@gmail.com') then 500 else 100 end
$f$;
revoke execute on function sc_discovery_daily_limit(uuid) from public, anon, authenticated;

do $do$
declare d text := pg_get_functiondef('rpc_submit_discovery'::regproc); n text;
begin
  n := replace(d, $a$if v_today_count >= 100 then raise exception 'daily limit reached (100 findings per day)'; end if;$a$,
    $a$if v_today_count >= sc_discovery_daily_limit(uid) then raise exception 'daily limit reached (% findings per day)', sc_discovery_daily_limit(uid); end if;$a$);
  if n = d then raise exception 'patch did not apply'; end if;
  execute n;
end $do$;
