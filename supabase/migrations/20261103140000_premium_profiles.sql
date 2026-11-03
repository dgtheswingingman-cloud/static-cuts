-- Premium profiles (£3/month or £30/year once payments are on; until then
-- the owner grants premium in the control room):
--   supporter badge next to their name around the site
--   profile colour, banner (GIF allowed), GIF avatar
--   showcase: up to 6 pinned songs at the top of their profile
-- The database refuses these for people without premium. If premium ends,
-- the settings are kept but not shown until it's back.

alter table profiles add column if not exists accent text;
alter table profiles add column if not exists banner_url text;
alter table profiles add column if not exists showcase text[] not null default '{}';

create or replace function sc_profile_premium_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare paid boolean;
begin
  if new.accent is not null and new.accent !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'Pick a colour like #8B7CF6.'; end if;
  if coalesce(array_length(new.showcase, 1), 0) > 6 then raise exception 'Up to 6 songs in your showcase.'; end if;
  if new.accent is distinct from old.accent and new.accent is not null
     or new.banner_url is distinct from old.banner_url and new.banner_url is not null
     or new.showcase is distinct from old.showcase and coalesce(array_length(new.showcase, 1), 0) > 0
     or new.avatar_url is distinct from old.avatar_url and new.avatar_url ~* '\.gif(\?|$)' then
    paid := is_premium(new.id);
    if not paid then raise exception 'That''s a premium profile perk.'; end if;
  end if;
  return new;
end;
$$;
create or replace trigger profiles_premium_guard before update on profiles
for each row execute function sc_profile_premium_guard();

-- Who of these people are supporters (for the badge).
create or replace function rpc_supporters(p_ids uuid[])
returns uuid[]
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(array_agg(u), '{}') from unnest(coalesce(p_ids, '{}')) u where is_premium(u);
$$;
grant execute on function rpc_supporters(uuid[]) to anon, authenticated;

-- A profile's premium look (empty when they don't have premium).
create or replace function rpc_profile_style(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select case when is_premium(p.id) then jsonb_build_object('premium', true, 'accent', p.accent, 'banner_url', p.banner_url,
    'showcase', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'artist_id', t.artist_id, 'artist', a.name,
        'status', t.release_status, 'cover', sc_track_cover(t.id) ->> 'url') order by x.n)
      from unnest(p.showcase) with ordinality x(id, n) join tracks t on t.id = x.id join artists a on a.id = t.artist_id), '[]'::jsonb))
  else jsonb_build_object('premium', false) end
  from profiles p where p.id = p_user;
$$;
grant execute on function rpc_profile_style(uuid) to anon, authenticated;
