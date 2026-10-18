-- Admin alerts ("background job failed", takedowns and so on) belong to
-- admin mode, not your personal notifications. Each notification call says
-- which side it's for:
--   p_admin = true   admin alerts only (admin mode)
--   p_admin = false  everything else; for the admin account that excludes
--                    admin alerts (moderators, who have no admin mode,
--                    still see everything sent to them)

drop function if exists rpc_my_notifications(int);
drop function if exists rpc_unread_notifications();
drop function if exists rpc_mark_notifications_read(uuid[]);

create or replace function sc_notification_side(p_kind text, p_admin boolean)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select case
    when p_admin then p_kind = 'admin'
    when auth.uid() in (select sc_admin_ids(false)) then p_kind <> 'admin'
    else true
  end;
$$;

create or replace function rpc_my_notifications(p_limit int default 50, p_admin boolean default false)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select jsonb_build_object(
    'unread', (select count(*) from notifications where user_id = auth.uid() and read_at is null and sc_notification_side(kind, p_admin)),
    'items', (select coalesce(jsonb_agg(to_jsonb(n) order by n.created_at desc), '[]'::jsonb) from (
       select id, kind, title, body, link, created_at, read_at from notifications
       where user_id = auth.uid() and sc_notification_side(kind, p_admin)
       order by created_at desc limit greatest(1, least(coalesce(p_limit, 50), 200))) n));
$$;

create or replace function rpc_unread_notifications(p_admin boolean default false)
returns int
language sql
stable
security definer
set search_path to 'public'
as $$
  select count(*)::int from notifications
  where user_id = auth.uid() and read_at is null and sc_notification_side(kind, p_admin);
$$;

create or replace function rpc_mark_notifications_read(p_ids uuid[] default null, p_admin boolean default false)
returns void
language sql
security definer
set search_path to 'public'
as $$
  update notifications set read_at = now()
  where user_id = auth.uid() and read_at is null and sc_notification_side(kind, p_admin)
    and (p_ids is null or id = any (p_ids));
$$;

revoke execute on function sc_notification_side(text, boolean) from public, anon;
revoke execute on function rpc_my_notifications(int, boolean), rpc_unread_notifications(boolean),
  rpc_mark_notifications_read(uuid[], boolean) from public, anon;
grant execute on function sc_notification_side(text, boolean), rpc_my_notifications(int, boolean),
  rpc_unread_notifications(boolean), rpc_mark_notifications_read(uuid[], boolean) to authenticated;

select 'admin alerts split' as result;
