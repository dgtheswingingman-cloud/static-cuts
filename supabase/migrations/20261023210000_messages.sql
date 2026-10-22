-- Messages between friends (people who follow each other). Only the two
-- people in a chat can read it. A new message also shows in the recipient's
-- notifications (one per person, bumped by each new message).

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  sender uuid not null references auth.users(id) on delete cascade,
  recipient uuid not null references auth.users(id) on delete cascade,
  body text not null check (length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists messages_pair_idx on messages (sender, recipient, created_at desc);
create index if not exists messages_unread_idx on messages (recipient) where read_at is null;
alter table messages enable row level security;
revoke all on messages from anon, authenticated;
grant select on messages to authenticated;
drop policy if exists messages_read_own on messages;
create policy messages_read_own on messages for select to authenticated
  using (sender = (select auth.uid()) or recipient = (select auth.uid()));

create or replace function rpc_send_message(p_to uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_me uuid := auth.uid();
  v_id uuid;
  v_body text := btrim(coalesce(p_body, ''));
begin
  if v_me is null then raise exception 'Log in first.'; end if;
  if p_to is null or p_to = v_me then raise exception 'Pick someone to message.'; end if;
  if not sc_is_friend(p_to) then raise exception 'You can only message friends (people who follow you back).'; end if;
  if v_body = '' then raise exception 'Write something first.'; end if;
  if length(v_body) > 2000 then raise exception 'That''s too long (2,000 characters max).'; end if;
  if (select count(*) from messages where sender = v_me and created_at > now() - interval '1 minute') >= 20 then
    raise exception 'Slow down a bit.';
  end if;
  insert into messages (sender, recipient, body) values (v_me, p_to, v_body) returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function rpc_send_message(uuid, text) from public, anon;
grant execute on function rpc_send_message(uuid, text) to authenticated;

-- Mark a chat as read (also clears its notification).
create or replace function rpc_read_messages(p_with uuid)
returns void
language sql
security definer
set search_path to 'public'
as $$
  update messages set read_at = now() where recipient = auth.uid() and sender = p_with and read_at is null;
  update notifications set read_at = now() where user_id = auth.uid() and dedupe_key = 'msg:' || p_with and read_at is null;
$$;
revoke execute on function rpc_read_messages(uuid) from public, anon;
grant execute on function rpc_read_messages(uuid) to authenticated;

create or replace function rpc_unread_messages()
returns int
language sql
stable
security definer
set search_path to 'public'
as $$
  select count(*)::int from messages where recipient = auth.uid() and read_at is null;
$$;
revoke execute on function rpc_unread_messages() from public, anon;
grant execute on function rpc_unread_messages() to authenticated;

-- Chats: everyone you've messaged with, plus friends you haven't yet.
create or replace function rpc_conversations()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  with me as (select auth.uid() id),
  chats as (
    select case when m.sender = me.id then m.recipient else m.sender end other, m.body, m.created_at, m.sender = me.id mine
    from messages m, me where m.sender = me.id or m.recipient = me.id
  ), last as (
    select distinct on (other) other, body, created_at, mine from chats order by other, created_at desc
  ), friends as (
    select a.followee other from me
    join user_follows a on a.follower = me.id
    join user_follows b on b.follower = a.followee and b.followee = me.id
  ), people as (
    select other from last union select other from friends
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.other, 'name', pr.display_name, 'avatar_url', pr.avatar_url,
    'last', l.body, 'last_at', l.created_at, 'last_mine', l.mine,
    'unread', (select count(*) from messages m, me where m.recipient = me.id and m.sender = p.other and m.read_at is null),
    'friend', exists (select 1 from friends f where f.other = p.other)
  ) order by l.created_at desc nulls last, pr.display_name), '[]'::jsonb)
  from people p
  left join last l on l.other = p.other
  left join profiles pr on pr.id = p.other;
$$;
revoke execute on function rpc_conversations() from public, anon;
grant execute on function rpc_conversations() to authenticated;

-- Notification for the recipient: one per sender, brought back to unread by
-- each new message (and pushed again only if it had been read).
create or replace function sc_message_notify()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_name text := coalesce((select display_name from profiles where id = new.sender), 'Someone');
begin
  insert into notifications (user_id, kind, title, body, link, dedupe_key)
  values (new.recipient, 'message', v_name || ' sent you a message', left(new.body, 140),
          '/messages/' || new.sender, 'msg:' || new.sender)
  on conflict (user_id, dedupe_key) where dedupe_key is not null do update
    set title = excluded.title, body = excluded.body, created_at = now(),
        pushed_at = case when notifications.read_at is null then notifications.pushed_at end,
        read_at = null;
  return null;
end;
$$;
drop trigger if exists messages_notify on messages;
create trigger messages_notify after insert on messages for each row execute function sc_message_notify();
