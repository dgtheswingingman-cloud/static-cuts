-- Discord bot (slash commands through Discord's interactions endpoint, run
-- by the 'discord' edge function; no always-on server):
--   /song <name>     the best match: status, artist, album, versions, link
--   /artist <name>   songs, unreleased count, latest leaks, link
--   /leaks [artist]  the latest leaks (site-wide or for one artist)
--   /alerts add|remove|list <artist>   post that artist's new leaks,
--                    snippets and releases in this channel (Manage Channels)
-- Alerts use the same rules as phone alerts (a real change, not a backfill)
-- and are posted every 2 minutes, grouped per channel, at most 5 per artist
-- per channel an hour. Never links to files: only to song pages.

create table if not exists discord_alert_subs (
  channel_id text not null,
  guild_id text,
  artist_id text not null,
  added_by text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (channel_id, artist_id)
);
create index if not exists discord_alert_subs_artist on discord_alert_subs (artist_id);

create table if not exists discord_alert_queue (
  id bigint generated always as identity primary key,
  channel_id text not null,
  track_id text not null,
  kind text not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists discord_alert_queue_unsent on discord_alert_queue (created_at) where sent_at is null;

alter table discord_alert_subs enable row level security;
alter table discord_alert_queue enable row level security;

-- An artist from what someone typed: exact name or nickname first, then the
-- biggest artist whose name starts with it.
create or replace function sc_discord_find_artist(p_q text)
returns table (id text, name text)
language sql
stable
security definer
set search_path to 'public'
as $$
  with q as (select lower(trim(coalesce(p_q, ''))) q)
  select a.id, a.name from artists a, q
  where q.q <> '' and (lower(a.name) = q.q or exists (select 1 from artist_aliases al where al.artist_id = a.id and lower(al.alias) = q.q))
  union all
  (select a.id, a.name from artists a, q
   where q.q <> '' and lower(a.name) like q.q || '%'
   order by coalesce((select c.n from artist_track_counts c where c.artist_id = a.id), 0) desc limit 1)
  limit 1;
$$;
revoke execute on function sc_discord_find_artist(text) from public, anon, authenticated;

create or replace function sc_discord_enqueue(p_track text, p_kind text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_artist text := (select artist_id from tracks where id = p_track);
begin
  if v_artist is null then return; end if;
  insert into discord_alert_queue (channel_id, track_id, kind)
  select s.channel_id, p_track, p_kind from discord_alert_subs s
  where s.artist_id = v_artist and s.active
    and (select count(*) from discord_alert_queue q join tracks t on t.id = q.track_id
         where q.channel_id = s.channel_id and t.artist_id = v_artist and q.created_at > now() - interval '1 hour') < 5;
end;
$$;
revoke execute on function sc_discord_enqueue(text, text) from public, anon, authenticated;

-- Same rules as the phone alerts (sc_alert_on_status / sc_alert_on_new_track).
create or replace function sc_discord_on_status()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not exists (select 1 from discord_alert_subs where active) then return null; end if;
  if new.to_status is not distinct from new.from_status then return null; end if;
  if new.from_status is null then return null; end if; -- new songs: the tracks trigger
  if new.to_status in ('leaked', 'snippet') or (new.to_status = 'released' and new.from_status <> 'unconfirmed') then
    perform sc_discord_enqueue(new.track_id, new.to_status);
  end if;
  return null;
end;
$$;
create or replace trigger track_status_discord after insert on track_status_events
for each row execute function sc_discord_on_status();

create or replace function sc_discord_on_new_track()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not exists (select 1 from discord_alert_subs where active) then return null; end if;
  if new.parent_track_id is not null then return null; end if;
  if new.release_status in ('leaked', 'snippet') or (new.release_status = 'released' and new.release_date >= current_date - 7) then
    perform sc_discord_enqueue(new.id, new.release_status);
  end if;
  return null;
end;
$$;
create or replace trigger track_new_discord after insert on tracks
for each row execute function sc_discord_on_new_track();

-- Subscribe / unsubscribe a channel (the edge function checks the person
-- has Manage Channels).
create or replace function sc_discord_sub(p_secret text, p_guild text, p_channel text, p_artist_q text, p_on boolean, p_user text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare a record;
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then raise exception 'not authorized'; end if;
  select * into a from sc_discord_find_artist(p_artist_q);
  if a.id is null then return jsonb_build_object('ok', false, 'error', 'No artist called that on Static Cuts.'); end if;
  if p_on then
    if (select count(*) from discord_alert_subs where channel_id = p_channel and active) >= 25 then
      return jsonb_build_object('ok', false, 'error', 'This channel already follows 25 artists.');
    end if;
    insert into discord_alert_subs (channel_id, guild_id, artist_id, added_by) values (p_channel, p_guild, a.id, p_user)
    on conflict (channel_id, artist_id) do update set active = true, added_by = excluded.added_by;
  else
    update discord_alert_subs set active = false where channel_id = p_channel and artist_id = a.id;
  end if;
  return jsonb_build_object('ok', true, 'artist_id', a.id, 'artist', a.name);
end;
$$;
revoke execute on function sc_discord_sub(text, text, text, text, boolean, text) from public, anon, authenticated;

create or replace function sc_discord_subs(p_secret text, p_channel text)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select case when p_secret = (select value from sc_private_settings where key = 'cron_secret') then
    coalesce((select jsonb_agg(jsonb_build_object('artist_id', a.id, 'artist', a.name) order by a.name)
      from discord_alert_subs s join artists a on a.id = s.artist_id where s.channel_id = p_channel and s.active), '[]'::jsonb) end;
$$;
revoke execute on function sc_discord_subs(text, text) from public, anon, authenticated;

-- Waiting alerts, oldest first, with what the message needs; marked sent.
create or replace function sc_discord_take(p_secret text, p_limit int default 60)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v jsonb;
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then raise exception 'not authorized'; end if;
  with pick as (
    select q.id from discord_alert_queue q where q.sent_at is null order by q.created_at limit p_limit for update skip locked
  ), done as (
    update discord_alert_queue q set sent_at = now() from pick where q.id = pick.id returning q.channel_id, q.track_id, q.kind
  )
  select coalesce(jsonb_agg(jsonb_build_object('channel_id', d.channel_id, 'kind', d.kind, 'track_id', t.id, 'title', t.title,
    'artist', a.name, 'artist_id', a.id, 'album', t.album, 'cover', sc_track_cover(t.id) ->> 'url')), '[]'::jsonb)
  into v from done d join tracks t on t.id = d.track_id join artists a on a.id = t.artist_id;
  return v;
end;
$$;
revoke execute on function sc_discord_take(text, int) from public, anon, authenticated;

-- Bot answers: one song, one artist, latest leaks.
create or replace function sc_discord_artist(p_secret text, p_q text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare a record;
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then raise exception 'not authorized'; end if;
  select * into a from sc_discord_find_artist(p_q);
  if a.id is null then return null; end if;
  return jsonb_build_object(
    'id', a.id, 'name', a.name,
    'photo', (select image_url from artists where id = a.id),
    'songs', coalesce((select n from artist_track_counts where artist_id = a.id), 0),
    'unreleased', (select count(*) from tracks where artist_id = a.id and release_status <> 'released'),
    'leaked', (select count(*) from tracks where artist_id = a.id and release_status = 'leaked'),
    'latest', coalesce((select jsonb_agg(x) from (
      select jsonb_build_object('id', t.id, 'title', t.title, 'status', t.release_status, 'on', coalesce(t.leak_date, t.release_date)) x
      from tracks t where t.artist_id = a.id and t.release_status in ('leaked', 'snippet') and t.parent_track_id is null
      order by coalesce(t.leak_date, t.created_at::date) desc nulls last limit 5) y), '[]'::jsonb));
end;
$$;
revoke execute on function sc_discord_artist(text, text) from public, anon, authenticated;

create or replace function sc_discord_leaks(p_secret text, p_artist_q text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare v_id text; v_name text;
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then raise exception 'not authorized'; end if;
  if coalesce(trim(p_artist_q), '') <> '' then
    select f.id, f.name into v_id, v_name from sc_discord_find_artist(p_artist_q) f;
    if v_id is null then return null; end if;
  end if;
  -- Real new leaks only: a status change (not a tracker backfill) or a song
  -- added with a recent leak date.
  return jsonb_build_object('artist', v_name, 'items', coalesce((select jsonb_agg(x) from (
    select jsonb_build_object('id', t.id, 'title', t.title, 'artist', ar.name, 'on', e.created_at::date) x
    from track_status_events e join tracks t on t.id = e.track_id join artists ar on ar.id = t.artist_id
    where e.to_status = 'leaked' and t.release_status = 'leaked' and t.parent_track_id is null
      and ((e.from_status is not null and e.from_status <> 'unconfirmed') or t.leak_date >= current_date - 60)
      and (v_id is null or t.artist_id = v_id) and e.created_at > now() - interval '60 days'
    order by e.created_at desc limit 10) y), '[]'::jsonb));
end;
$$;
revoke execute on function sc_discord_leaks(text, text) from public, anon, authenticated;

insert into sc_private_settings (key, value) values ('discord_per_minute', '30'), ('discord_per_day', '20000')
on conflict (key) do nothing;

-- Every 2 minutes, only when alerts are waiting.
select cron.schedule('discord-alerts', '*/2 * * * *', $cmd$
  select net.http_post(
    url := 'https://pcuyzaamcsegblrauxsa.supabase.co/functions/v1/run-job',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select value from public.sc_private_settings where key = 'cron_secret')),
    body := jsonb_build_object('fn', 'discord', 'body', jsonb_build_object('mode', 'post')),
    timeout_milliseconds := 15000)
  where exists (select 1 from public.discord_alert_queue q where q.sent_at is null);
$cmd$);
