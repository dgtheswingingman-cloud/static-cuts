-- Claude's sub-version checks get a daily cap (the edge function reads it),
-- so a big import is worked through over a few days instead of spending in
-- one go. Admins can see today's count and ask for more today.
insert into sc_private_settings (key, value) values ('version_ai_per_day', '500')
on conflict (key) do nothing;

create or replace function admin_version_ai_today()
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $$
  with s as (
    select coalesce((select value from sc_private_settings where key = 'version_ai_per_day'), '500')::int cap,
           (select value from sc_private_settings where key = 'version_ai_extra') extra)
  select case when not is_admin() then null else jsonb_build_object(
    'cap', s.cap + case when split_part(coalesce(s.extra, ''), ':', 1) = to_char(now() at time zone 'utc', 'YYYY-MM-DD')
                        then coalesce(nullif(split_part(s.extra, ':', 2), '')::int, 0) else 0 end,
    'checked', (select count(*) from version_suggestions where ai_checked_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'),
    'waiting', (select count(*) from version_suggestions where state = 'open' and ai_checked_at is null)) end
  from s;
$$;

create or replace function admin_version_ai_more(p_n int default 500)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare d text := to_char(now() at time zone 'utc', 'YYYY-MM-DD'); cur text; n int;
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  if p_n not between 1 and 5000 then raise exception 'between 1 and 5000'; end if;
  select value into cur from sc_private_settings where key = 'version_ai_extra';
  n := case when split_part(coalesce(cur, ''), ':', 1) = d then coalesce(nullif(split_part(cur, ':', 2), '')::int, 0) else 0 end + p_n;
  insert into sc_private_settings (key, value) values ('version_ai_extra', d || ':' || n)
  on conflict (key) do update set value = excluded.value;
  return admin_version_ai_today();
end $$;

revoke execute on function admin_version_ai_today() from public, anon;
revoke execute on function admin_version_ai_more(int) from public, anon;
grant execute on function admin_version_ai_today() to authenticated;
grant execute on function admin_version_ai_more(int) to authenticated;
