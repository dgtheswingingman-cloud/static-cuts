-- Following people, and friends.
--   follow: one way. You see their public activity.
--   friends: you follow each other. Friends can also see each other's
--   collection, ratings and followed artists even when those are set to
--   private, see what each other have been up to (/friends), and see which
--   friends have a song on its page.
-- Following someone sends them a notification ("X followed you - follow
-- back to be friends").

create table if not exists user_follows (
  follower uuid not null references auth.users (id) on delete cascade,
  followee uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower, followee),
  check (follower <> followee)
);
create index if not exists user_follows_followee on user_follows (followee);
alter table user_follows enable row level security;
drop policy if exists "Anyone can see who follows who" on user_follows;
create policy "Anyone can see who follows who" on user_follows for select using (true);
drop policy if exists "Follow as yourself" on user_follows;
create policy "Follow as yourself" on user_follows for insert to authenticated
  with check ((select auth.uid()) = follower and not is_oauth_client());
drop policy if exists "Unfollow as yourself" on user_follows;
create policy "Unfollow as yourself" on user_follows for delete to authenticated
  using ((select auth.uid()) = follower and not is_oauth_client());
grant select on user_follows to anon, authenticated;
grant insert, delete on user_follows to authenticated;

-- Is the signed-in person friends with p_user (following each other)?
create or replace function sc_is_friend(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from user_follows a
    join user_follows b on b.follower = a.followee and b.followee = a.follower
    where a.follower = auth.uid() and a.followee = p_user);
$$;
grant execute on function sc_is_friend(uuid) to anon, authenticated;

-- Friends can see each other's private collection, ratings and artists.
drop policy if exists "Users can read own or publicly shared collections" on track_ownership;
create policy "Users can read own or publicly shared collections" on track_ownership for select
  using ((select auth.uid()) = user_id
         or exists (select 1 from profiles p where p.id = track_ownership.user_id and p.show_collected_tracks = true)
         or sc_is_friend(user_id));
drop policy if exists "Users can read own or publicly shared ratings" on ratings;
create policy "Users can read own or publicly shared ratings" on ratings for select
  using ((select auth.uid()) = user_id
         or exists (select 1 from profiles p where p.id = ratings.user_id and p.show_ratings = true)
         or sc_is_friend(user_id));
drop policy if exists "Users can read own or publicly shared follows" on follows;
create policy "Users can read own or publicly shared follows" on follows for select
  using ((select auth.uid()) = user_id
         or exists (select 1 from profiles p where p.id = follows.user_id and p.show_followed_artists = true)
         or sc_is_friend(user_id));

-- Notify on a new follow (once per pair).
create or replace function sc_user_follow_notify()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_name text := coalesce((select display_name from profiles where id = new.follower), 'Someone');
  v_back boolean := exists (select 1 from user_follows where follower = new.followee and followee = new.follower);
begin
  if not exists (select 1 from notifications where user_id = new.followee and dedupe_key = 'follow:' || new.follower) then
    insert into notifications (user_id, kind, title, body, link, dedupe_key)
    values (new.followee, 'follow',
            case when v_back then v_name || ' followed you back: you''re friends now' else v_name || ' followed you' end,
            case when v_back then null else 'Follow them back to be friends.' end,
            '/profile/' || new.follower, 'follow:' || new.follower);
  end if;
  return new;
end;
$$;
drop trigger if exists user_follows_notify on user_follows;
create trigger user_follows_notify after insert on user_follows for each row execute function sc_user_follow_notify();

-- Follower counts and where you stand with someone, for their profile.
create or replace function rpc_profile_social(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select jsonb_build_object(
    'followers', (select count(*) from user_follows where followee = p_user),
    'following', (select count(*) from user_follows where follower = p_user),
    'i_follow', exists (select 1 from user_follows where follower = auth.uid() and followee = p_user),
    'follows_me', exists (select 1 from user_follows where follower = p_user and followee = auth.uid()),
    'friends', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.display_name, 'avatar_url', p.avatar_url) order by p.display_name)
      from user_follows a
      join user_follows b on b.follower = a.followee and b.followee = a.follower
      join profiles p on p.id = a.followee
      where a.follower = p_user), '[]'::jsonb));
$$;
grant execute on function rpc_profile_social(uuid) to anon, authenticated;

-- What your friends have been up to: songs collected, rated or added.
create or replace function rpc_friends_activity(p_limit int default 60)
returns table (at timestamptz, kind text, user_id uuid, name text, avatar_url text,
               track_id text, title text, artist_id text, artist text, value int)
language sql
stable
security definer
set search_path to 'public'
as $$
  with friends as (
    select a.followee id from user_follows a
    join user_follows b on b.follower = a.followee and b.followee = a.follower
    where a.follower = auth.uid()
  ), ev as (
    select o.collected_at at, 'collected' kind, o.user_id, o.track_id, null::int value
    from track_ownership o where o.user_id in (select id from friends) and o.collected_at > now() - interval '60 days'
    union all
    select r.updated_at, 'rated', r.user_id, r.track_id, r.value
    from ratings r where r.user_id in (select id from friends) and r.updated_at > now() - interval '60 days'
    union all
    select t.created_at, 'added', t.added_by, t.id, null
    from tracks t where t.added_by in (select id from friends) and t.created_at > now() - interval '60 days'
  )
  select ev.at, ev.kind, ev.user_id, p.display_name, p.avatar_url, ev.track_id, t.title, t.artist_id, a.name, ev.value
  from ev
  join profiles p on p.id = ev.user_id
  join tracks t on t.id = ev.track_id
  left join artists a on a.id = t.artist_id
  order by ev.at desc nulls last
  limit greatest(1, least(coalesce(p_limit, 60), 200));
$$;
grant execute on function rpc_friends_activity(int) to authenticated;

-- Friends who have collected a song (for its page).
create or replace function rpc_song_friends(p_track_id text)
returns table (user_id uuid, name text, avatar_url text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select p.id, p.display_name, p.avatar_url
  from track_ownership o
  join profiles p on p.id = o.user_id
  where o.track_id = p_track_id and sc_is_friend(o.user_id)
  order by p.display_name
  limit 20;
$$;
grant execute on function rpc_song_friends(text) to authenticated;
