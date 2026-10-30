-- Local Cuts "ask Claude": daily runs per person. The owner is only limited
-- by the site's shared Claude allowance; moderators get 200 a day; everyone
-- else 40 (each run covers up to 25 files).
create or replace function sc_local_ai_take(p_user uuid, p_calls integer)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  used int;
  give int;
  cap int := case
    when exists (select 1 from auth.users u where u.id = p_user and u.email = 'dg.theswingingman@gmail.com') then 100000
    when exists (select 1 from moderators m where m.user_id = p_user) then 200
    else 40 end;
begin
  insert into local_ai_usage (user_id, day, calls) values (p_user, current_date, 0) on conflict do nothing;
  select calls into used from local_ai_usage where user_id = p_user and day = current_date for update;
  give := greatest(0, least(coalesce(p_calls, 0), cap - used));
  update local_ai_usage set calls = calls + give where user_id = p_user and day = current_date;
  return give;
end;
$$;
revoke execute on function sc_local_ai_take(uuid, integer) from public, anon, authenticated;
