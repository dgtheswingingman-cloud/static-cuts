-- Covers for songs that have no art of their own:
--   1. the song's own art (tracks.cover_url, from the services)
--   2. fan covers: anyone signed in can add a picture to a song with no art;
--      the most-voted one shows (tracks.fan_cover_url)
--   3. otherwise a photo of the artist, spread across their photos so songs
--      don't all share one picture (artist_photos; anyone signed in can add)
-- Fan pictures never replace a song's own art. Moderators can remove any.
-- sc_track_cover() gives the picture to show and where it came from.

create table if not exists track_fan_covers (
  id uuid primary key default gen_random_uuid(),
  track_id text not null,
  user_id uuid not null,
  url text not null,
  removed boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists track_fan_covers_track on track_fan_covers (track_id) where not removed;

create table if not exists track_fan_cover_votes (
  cover_id uuid not null,
  user_id uuid not null,
  active boolean not null default true,
  voted_at timestamptz not null default now(),
  primary key (cover_id, user_id)
);

create table if not exists artist_photos (
  id uuid primary key default gen_random_uuid(),
  artist_id text not null,
  url text not null,
  added_by uuid,
  removed boolean not null default false,
  created_at timestamptz not null default now(),
  unique (artist_id, url)
);
create index if not exists artist_photos_artist on artist_photos (artist_id) where not removed;

alter table track_fan_covers enable row level security;
alter table track_fan_cover_votes enable row level security;
alter table artist_photos enable row level security;
create policy "Public can read fan covers" on track_fan_covers for select using (not removed);
create policy "Public can read artist photos" on artist_photos for select using (not removed);

alter table tracks add column if not exists fan_cover_url text;

-- Uploads: covers/fan/<user>/... and covers/artist/<user>/...
create policy "Signed-in users upload fan covers and artist photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'covers' and (storage.foldername(name))[1] in ('fan', 'artist')
              and (storage.foldername(name))[2] = auth.uid()::text);

-- Every artist's current photo is their first one.
insert into artist_photos (artist_id, url)
select id, image_url from artists where image_url is not null
on conflict (artist_id, url) do nothing;

-- The picture to show for a song, and where it came from.
create or replace function sc_track_cover(p_track text)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  with t as (select id, artist_id, cover_url, fan_cover_url from tracks where id = p_track),
  ph as (
    select p.url, row_number() over (order by p.created_at, p.id) - 1 n, count(*) over () c
    from artist_photos p join t on p.artist_id = t.artist_id where not p.removed)
  select case
    when t.cover_url is not null then jsonb_build_object('url', t.cover_url, 'kind', 'own')
    when t.fan_cover_url is not null then jsonb_build_object('url', t.fan_cover_url, 'kind', 'fan')
    else (select jsonb_build_object('url', ph.url, 'kind', 'artist') from ph
          where ph.n = abs(hashtext(t.id)) % greatest(ph.c, 1) limit 1)
  end
  from t;
$$;
grant execute on function sc_track_cover(text) to anon, authenticated;

-- Keep tracks.fan_cover_url = the most-voted fan cover.
create or replace function sc_fan_cover_refresh(p_track text)
returns void
language sql
security definer
set search_path to 'public'
as $$
  update tracks set fan_cover_url = (
    select c.url from track_fan_covers c
    left join track_fan_cover_votes v on v.cover_id = c.id and v.active
    where c.track_id = p_track and not c.removed
    group by c.id, c.url, c.created_at
    order by count(v.user_id) desc, c.created_at
    limit 1)
  where id = p_track;
$$;
revoke execute on function sc_fan_cover_refresh(text) from public, anon, authenticated;

-- A song's fan covers, most-voted first.
create or replace function rpc_fan_covers(p_track text)
returns table (id uuid, url text, votes int, mine boolean, voted boolean, by_name text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select c.id, c.url,
    (select count(*)::int from track_fan_cover_votes v where v.cover_id = c.id and v.active),
    c.user_id = auth.uid(),
    exists (select 1 from track_fan_cover_votes v where v.cover_id = c.id and v.user_id = auth.uid() and v.active),
    (select display_name from profiles p where p.id = c.user_id)
  from track_fan_covers c
  where c.track_id = p_track and not c.removed
  order by 3 desc, c.created_at
  limit 12;
$$;
grant execute on function rpc_fan_covers(text) to anon, authenticated;

create or replace function rpc_fan_cover_add(p_track text, p_url text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare me uuid := auth.uid(); v_id uuid;
begin
  if me is null then raise exception 'Sign in to add a cover.'; end if;
  if not exists (select 1 from tracks where id = p_track) then raise exception 'unknown song'; end if;
  if exists (select 1 from tracks where id = p_track and cover_url is not null) then raise exception 'This song already has its own cover.'; end if;
  if p_url is null or position('/storage/v1/object/public/covers/fan/' || me::text || '/' in p_url) = 0 then raise exception 'Upload the picture first.'; end if;
  if (select count(*) from track_fan_covers where user_id = me and track_id = p_track and not removed) >= 3 then raise exception 'You''ve added 3 covers for this song already.'; end if;
  if (select count(*) from track_fan_covers where user_id = me and created_at > now() - interval '1 day') >= 50 then raise exception 'That''s plenty for today. Try again tomorrow.'; end if;
  insert into track_fan_covers (track_id, user_id, url) values (p_track, me, p_url) returning id into v_id;
  insert into track_fan_cover_votes (cover_id, user_id) values (v_id, me);
  perform sc_fan_cover_refresh(p_track);
  return v_id;
end;
$$;
grant execute on function rpc_fan_cover_add(text, text) to authenticated;

create or replace function rpc_fan_cover_vote(p_cover uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare me uuid := auth.uid(); v_track text;
begin
  if me is null then raise exception 'Sign in to vote.'; end if;
  select track_id into v_track from track_fan_covers where id = p_cover and not removed;
  if v_track is null then raise exception 'unknown cover'; end if;
  insert into track_fan_cover_votes (cover_id, user_id, active) values (p_cover, me, coalesce(p_on, true))
  on conflict (cover_id, user_id) do update set active = excluded.active, voted_at = now();
  perform sc_fan_cover_refresh(v_track);
end;
$$;
grant execute on function rpc_fan_cover_vote(uuid, boolean) to authenticated;

create or replace function admin_fan_cover_remove(p_cover uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_track text;
begin
  select track_id into v_track from track_fan_covers where id = p_cover;
  if not (is_moderator() or exists (select 1 from track_fan_covers where id = p_cover and user_id = auth.uid())) then raise exception 'not authorized'; end if;
  update track_fan_covers set removed = true where id = p_cover;
  perform sc_fan_cover_refresh(v_track);
end;
$$;
grant execute on function admin_fan_cover_remove(uuid) to authenticated;

-- Artist photos.
create or replace function rpc_artist_photo_add(p_artist text, p_url text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare me uuid := auth.uid(); v_id uuid;
begin
  if me is null then raise exception 'Sign in to add a photo.'; end if;
  if not exists (select 1 from artists where id = p_artist) then raise exception 'unknown artist'; end if;
  if p_url is null or position('/storage/v1/object/public/covers/artist/' || me::text || '/' in p_url) = 0 then raise exception 'Upload the photo first.'; end if;
  if (select count(*) from artist_photos where added_by = me and created_at > now() - interval '1 day') >= 30 then raise exception 'That''s plenty for today. Try again tomorrow.'; end if;
  insert into artist_photos (artist_id, url, added_by) values (p_artist, p_url, me)
  on conflict (artist_id, url) do update set removed = false
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function rpc_artist_photo_add(text, text) to authenticated;

create or replace function admin_artist_photo_remove(p_photo uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not (is_moderator() or exists (select 1 from artist_photos where id = p_photo and added_by = auth.uid())) then raise exception 'not authorized'; end if;
  update artist_photos set removed = true where id = p_photo;
end;
$$;
grant execute on function admin_artist_photo_remove(uuid) to authenticated;

-- Song page: the picture to show and where it came from.
do $do$
declare d text := pg_get_functiondef('rpc_song_page(text)'::regprocedure);
begin
  if position('display_cover' in d) = 0 then
    if position('''credited_as'', t.credited_as,' in d) = 0 then raise exception 'rpc_song_page: anchor not found'; end if;
    d := replace(d, '''credited_as'', t.credited_as,', '''credited_as'', t.credited_as, ''display_cover'', sc_track_cover(t.id),');
    execute d;
  end if;
end;
$do$;
