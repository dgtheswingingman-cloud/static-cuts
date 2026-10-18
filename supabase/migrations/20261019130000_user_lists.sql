-- User lists ("best Carti leaks"): anyone signed in can make lists of songs,
-- put them in order with a note on each, share them and follow other
-- people's lists.
--
--   song_lists         title, description, public or private
--   song_list_items    the songs, in order, with an optional note
--   song_list_follows  who follows which list
--
-- Limits: 50 lists per person, 500 songs per list. Songs that get merged
-- stay on lists (they move to the surviving song).

create table if not exists song_lists (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  title text not null check (length(trim(title)) between 1 and 120),
  description text check (description is null or length(description) <= 2000),
  is_public boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists song_lists_owner_idx on song_lists (owner_id, updated_at desc);

create table if not exists song_list_items (
  list_id uuid not null references song_lists (id) on delete cascade,
  track_id text not null references tracks (id) on delete cascade,
  position int not null default 0,
  note text check (note is null or length(note) <= 500),
  added_at timestamptz not null default now(),
  primary key (list_id, track_id)
);
create index if not exists song_list_items_track_idx on song_list_items (track_id);

create table if not exists song_list_follows (
  list_id uuid not null references song_lists (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  followed_at timestamptz not null default now(),
  primary key (list_id, user_id)
);
create index if not exists song_list_follows_user_idx on song_list_follows (user_id);

alter table song_lists enable row level security;
alter table song_list_items enable row level security;
alter table song_list_follows enable row level security;

drop policy if exists song_lists_read on song_lists;
create policy song_lists_read on song_lists for select using (is_public or owner_id = (select auth.uid()));
drop policy if exists song_lists_write on song_lists;
create policy song_lists_write on song_lists for all to authenticated
  using (owner_id = (select auth.uid()) and not is_oauth_client())
  with check (owner_id = (select auth.uid()) and not is_oauth_client());

drop policy if exists song_list_items_read on song_list_items;
create policy song_list_items_read on song_list_items for select using (
  exists (select 1 from song_lists l where l.id = list_id and (l.is_public or l.owner_id = (select auth.uid()))));
drop policy if exists song_list_items_write on song_list_items;
create policy song_list_items_write on song_list_items for all to authenticated
  using (exists (select 1 from song_lists l where l.id = list_id and l.owner_id = (select auth.uid())) and not is_oauth_client())
  with check (exists (select 1 from song_lists l where l.id = list_id and l.owner_id = (select auth.uid())) and not is_oauth_client());

drop policy if exists song_list_follows_read on song_list_follows;
create policy song_list_follows_read on song_list_follows for select using (user_id = (select auth.uid()));
drop policy if exists song_list_follows_write on song_list_follows;
create policy song_list_follows_write on song_list_follows for all to authenticated
  using (user_id = (select auth.uid()) and not is_oauth_client())
  with check (user_id = (select auth.uid()) and not is_oauth_client()
              and exists (select 1 from song_lists l where l.id = list_id and l.is_public and l.owner_id <> (select auth.uid())));

revoke all on song_lists, song_list_items, song_list_follows from anon;
grant select on song_lists, song_list_items to anon;

-- Limits, and keep "updated" fresh when songs change.
create or replace function song_lists_limits()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if tg_table_name = 'song_lists' then
    if (select count(*) from song_lists where owner_id = new.owner_id) >= 50 then
      raise exception 'You can have up to 50 lists.';
    end if;
  else
    if (select count(*) from song_list_items where list_id = new.list_id) >= 500 then
      raise exception 'A list can hold up to 500 songs.';
    end if;
    if coalesce(new.position, 0) = 0 then
      new.position := coalesce((select max(position) from song_list_items where list_id = new.list_id), 0) + 1;
    end if;
    update song_lists set updated_at = now() where id = new.list_id;
  end if;
  return new;
end;
$$;
drop trigger if exists song_lists_limits on song_lists;
create trigger song_lists_limits before insert on song_lists for each row execute function song_lists_limits();
drop trigger if exists song_list_items_limits on song_list_items;
create trigger song_list_items_limits before insert on song_list_items for each row execute function song_lists_limits();

-- Merged songs stay on lists.
create or replace function song_list_items_follow_merge()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into song_list_items (list_id, track_id, position, note, added_at)
  select i.list_id, new.new_track_id, i.position, i.note, i.added_at
  from song_list_items i where i.track_id = new.old_track_id
  on conflict do nothing;
  return new;
end;
$$;
drop trigger if exists song_list_items_follow_merge on track_redirects;
create trigger song_list_items_follow_merge before insert on track_redirects
for each row execute function song_list_items_follow_merge();

-- ---------------------------------------------------------------------------
-- Reading
-- ---------------------------------------------------------------------------

-- One list with its songs, for /list/<id>.
create or replace function rpc_list_page(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  l song_lists%rowtype;
begin
  select * into l from song_lists where id = p_id;
  if l.id is null or not (l.is_public or l.owner_id = auth.uid()) then return null; end if;
  return jsonb_build_object(
    'list', jsonb_build_object('id', l.id, 'title', l.title, 'description', l.description, 'is_public', l.is_public,
                               'created_at', l.created_at, 'updated_at', l.updated_at),
    'owner', (select jsonb_build_object('id', p.id, 'name', coalesce(p.display_name, 'someone'), 'avatar_url', p.avatar_url)
              from profiles p where p.id = l.owner_id),
    'is_owner', l.owner_id = auth.uid(),
    'following', exists (select 1 from song_list_follows f where f.list_id = l.id and f.user_id = auth.uid()),
    'followers', (select count(*) from song_list_follows f where f.list_id = l.id),
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
                'track_id', t.id, 'title', t.title, 'artist_id', t.artist_id, 'artist', a.name, 'note', i.note,
                'status', coalesce(t.release_status, case when t.is_official then 'released' else 'unconfirmed' end),
                'spotify_url', t.spotify_url, 'album', t.album) order by i.position, i.added_at), '[]'::jsonb)
              from song_list_items i join tracks t on t.id = i.track_id join artists a on a.id = t.artist_id
              where i.list_id = l.id));
end;
$$;

-- Browsing lists. p_kind: 'popular', 'new', 'mine', 'following', 'user'
-- (with p_user), 'song' (lists containing p_track).
create or replace function rpc_browse_lists(p_kind text default 'popular', p_user uuid default null,
                                            p_track text default null, p_offset int default 0)
returns table (id uuid, title text, description text, is_public boolean, owner_id uuid, owner_name text,
               songs bigint, followers bigint, updated_at timestamptz, artists text[], has_track boolean)
language sql
stable
security definer
set search_path to 'public'
as $$
  select l.id, l.title, l.description, l.is_public, l.owner_id, coalesce(p.display_name, 'someone'),
         (select count(*) from song_list_items i where i.list_id = l.id),
         (select count(*) from song_list_follows f where f.list_id = l.id),
         l.updated_at,
         (select array_agg(name) from (select a.name from song_list_items i join tracks t on t.id = i.track_id
            join artists a on a.id = t.artist_id where i.list_id = l.id group by a.name order by count(*) desc limit 3) x),
         case when p_track is null then false
              else exists (select 1 from song_list_items i where i.list_id = l.id and i.track_id = p_track) end
  from song_lists l left join profiles p on p.id = l.owner_id
  where (l.is_public or l.owner_id = auth.uid())
    and case p_kind
          when 'mine' then l.owner_id = auth.uid()
          when 'following' then exists (select 1 from song_list_follows f where f.list_id = l.id and f.user_id = auth.uid())
          when 'user' then l.owner_id = p_user and l.is_public
          when 'song' then l.is_public and exists (select 1 from song_list_items i where i.list_id = l.id and i.track_id = p_track)
          else l.is_public and exists (select 1 from song_list_items i where i.list_id = l.id)
        end
  order by
    case when p_kind = 'popular' then (select count(*) from song_list_follows f where f.list_id = l.id) end desc nulls last,
    l.updated_at desc
  offset greatest(coalesce(p_offset, 0), 0) limit 50;
$$;

-- Owner: put songs in this order.
create or replace function rpc_reorder_list(p_list uuid, p_track_ids text[])
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not exists (select 1 from song_lists where id = p_list and owner_id = auth.uid()) or is_oauth_client() then
    raise exception 'not your list';
  end if;
  update song_list_items i set position = x.n
  from unnest(p_track_ids) with ordinality x(track_id, n)
  where i.list_id = p_list and i.track_id = x.track_id;
  update song_lists set updated_at = now() where id = p_list;
end;
$$;

revoke execute on function song_lists_limits(), song_list_items_follow_merge() from public, anon, authenticated;
revoke execute on function rpc_list_page(uuid), rpc_browse_lists(text, uuid, text, int), rpc_reorder_list(uuid, text[]) from public;
grant execute on function rpc_list_page(uuid), rpc_browse_lists(text, uuid, text, int) to anon, authenticated;
grant execute on function rpc_reorder_list(uuid, text[]) to authenticated;
