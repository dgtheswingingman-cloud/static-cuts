-- The Network tab on your profile (it replaces the separate Friends page):
-- what your friends have done lately, now with covers, statuses and lists,
-- and people you might want to follow.

create or replace function public.rpc_friends_feed(p_limit integer default 60)
returns table(at timestamptz, kind text, user_id uuid, name text, avatar_url text,
              track_id text, list_id uuid, title text, artist_id text, artist text,
              cover_url text, status text, value integer)
language sql stable security definer set search_path to 'public' as $$
  with friends as (
    select a.followee id from user_follows a
    join user_follows b on b.follower = a.followee and b.followee = a.follower
    where a.follower = auth.uid()
  ), ev as (
    select o.collected_at at, 'collected' kind, o.user_id, o.track_id, null::uuid list_id, null::int value
    from track_ownership o where o.user_id in (select id from friends) and o.collected_at > now() - interval '60 days'
    union all
    select r.updated_at, 'rated', r.user_id, r.track_id, null, r.value
    from ratings r where r.user_id in (select id from friends) and r.updated_at > now() - interval '60 days'
    union all
    select t.created_at, 'added', t.added_by, t.id, null, null
    from tracks t where t.added_by in (select id from friends) and t.created_at > now() - interval '60 days'
    union all
    select l.updated_at, case when l.updated_at - l.created_at < interval '10 minutes' then 'list_new' else 'list' end,
           l.owner_id, null, l.id, null
    from song_lists l where l.owner_id in (select id from friends) and l.is_public and l.updated_at > now() - interval '60 days'
  )
  select ev.at, ev.kind, ev.user_id, p.display_name, p.avatar_url, ev.track_id, ev.list_id,
         coalesce(t.title, l.title), t.artist_id, a.name,
         coalesce(t.cover_url, l.cover_url,
                  (select t2.cover_url from song_list_items i join tracks t2 on t2.id = i.track_id
                   where i.list_id = l.id and t2.cover_url is not null limit 1)),
         t.release_status, ev.value
  from ev
  join profiles p on p.id = ev.user_id
  left join tracks t on t.id = ev.track_id
  left join song_lists l on l.id = ev.list_id
  left join artists a on a.id = t.artist_id
  where t.id is not null or l.id is not null
  order by ev.at desc nulls last
  limit greatest(1, least(coalesce(p_limit, 60), 200));
$$;

-- People who follow the same artists as you (only people who show the
-- artists they follow), that you don't follow yet.
create or replace function public.rpc_people_suggestions(p_limit integer default 8)
returns table(id uuid, name text, avatar_url text, shared integer, artists text[])
language sql stable security definer set search_path to 'public' as $$
  select p.id, p.display_name, p.avatar_url, count(*)::int,
         (array_agg(a.name order by a.name))[1:3]
  from follows mine
  join follows theirs on theirs.artist_id = mine.artist_id and theirs.user_id <> mine.user_id
  join profiles p on p.id = theirs.user_id and p.show_followed_artists
  join artists a on a.id = mine.artist_id
  where mine.user_id = auth.uid()
    and not exists (select 1 from user_follows u where u.follower = auth.uid() and u.followee = theirs.user_id)
  group by p.id, p.display_name, p.avatar_url
  order by count(*) desc, p.display_name
  limit greatest(1, least(coalesce(p_limit, 8), 30));
$$;

grant execute on function public.rpc_friends_feed(integer), public.rpc_people_suggestions(integer) to authenticated;
