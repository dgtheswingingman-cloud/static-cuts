-- Premium: Local Cuts (tidying files for Spotify, the player, collecting
-- from files, asking Claude) is a premium feature. For now the owner grants
-- it by hand (control room → Owner → Premium); payments come later. The
-- owner always has it. "Help the archive" stays free for everyone.

create table if not exists premium_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_at timestamptz not null default now(),
  until date,           -- null: no end date
  note text
);
alter table premium_members enable row level security;
create policy "See your own premium" on premium_members for select to authenticated using (user_id = auth.uid());

create or replace function is_premium(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select p_user is not null and (
    exists (select 1 from auth.users u where u.id = p_user and u.email = 'dg.theswingingman@gmail.com')
    or exists (select 1 from premium_members m where m.user_id = p_user and (m.until is null or m.until >= current_date)));
$$;
revoke execute on function is_premium(uuid) from public, anon, authenticated;

-- For the page: am I premium (and until when)?
create or replace function rpc_my_premium()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select jsonb_build_object('premium', is_premium(auth.uid()),
    'until', (select until from premium_members where user_id = auth.uid()));
$$;
revoke execute on function rpc_my_premium() from public;
grant execute on function rpc_my_premium() to anon, authenticated;

-- Owner: everyone with an account, and who has premium.
create or replace function owner_premium_list()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select case when is_owner() then coalesce(jsonb_agg(jsonb_build_object(
    'user_id', u.id, 'name', coalesce(p.display_name, 'someone'), 'joined', u.created_at,
    'premium', m.user_id is not null and (m.until is null or m.until >= current_date),
    'until', m.until, 'note', m.note) order by (m.user_id is not null) desc, lower(coalesce(p.display_name, ''))), '[]'::jsonb) end
  from auth.users u
  left join profiles p on p.id = u.id
  left join premium_members m on m.user_id = u.id
  where u.email is distinct from 'dg.theswingingman@gmail.com';
$$;
revoke execute on function owner_premium_list() from public, anon;
grant execute on function owner_premium_list() to authenticated;

-- Owner: give or take away premium (optionally until a date).
create or replace function owner_set_premium(p_user uuid, p_on boolean, p_until date default null, p_note text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not is_owner() then raise exception 'Only the owner can change this.'; end if;
  if p_on then
    insert into premium_members (user_id, until, note) values (p_user, p_until, nullif(trim(coalesce(p_note, '')), ''))
    on conflict (user_id) do update set until = excluded.until, note = coalesce(excluded.note, premium_members.note), granted_at = now();
  else
    delete from premium_members where user_id = p_user;
  end if;
end;
$$;
revoke execute on function owner_set_premium(uuid, boolean, date, text) from public, anon;
grant execute on function owner_set_premium(uuid, boolean, date, text) to authenticated;
