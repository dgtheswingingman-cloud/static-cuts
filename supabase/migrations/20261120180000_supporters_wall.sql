-- Supporters wall (/supporters): premium members and founders who've chosen
-- to be listed (Settings → Privacy, off by default like everything public).
alter table public.profiles add column if not exists show_on_supporters boolean not null default false;

create or replace function public.rpc_supporters()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_agg(x order by x.founder nulls last, x.since), '[]'::jsonb) from (
    select p.id user_id, p.display_name, p.avatar_url,
           (select f.number from premium_founders f where f.user_id = p.id) founder,
           (select min(m.granted_at) from premium_members m where m.user_id = p.id) since
    from profiles p
    where p.show_on_supporters
      and (is_premium(p.id) or exists (select 1 from premium_founders f where f.user_id = p.id))
  ) x;
$$;
grant execute on function public.rpc_supporters() to anon, authenticated;
