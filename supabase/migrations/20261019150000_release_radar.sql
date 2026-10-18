-- Release radar and notifications.
--
-- Radar (/radar): everything announced or with a release date coming up,
-- with countdowns, plus what's just dropped. "Remind me" on a song
-- (radar_watches) means you're told when:
--   - its release day arrives (checked each morning), or
--   - its status changes (announced -> released, snippet -> leaked, ...).
-- Songs you've collected also tell you when their status changes (but not
-- for routine "unconfirmed -> released" link matching, which would be noise).
--
-- Notifications (/notifications) are shown in the site; the bell on the
-- homepage shows how many are unread. They're kept for 90 days.

create table if not exists radar_watches (
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  track_id text not null references tracks (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, track_id)
);
create index if not exists radar_watches_track_idx on radar_watches (track_id);
alter table radar_watches enable row level security;
drop policy if exists radar_watches_own on radar_watches;
create policy radar_watches_own on radar_watches for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and not is_oauth_client());

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  link text,
  track_id text,
  dedupe_key text,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists notifications_user_idx on notifications (user_id, created_at desc);
create unique index if not exists notifications_dedupe_idx on notifications (user_id, dedupe_key) where dedupe_key is not null;
alter table notifications enable row level security;
drop policy if exists notifications_own_read on notifications;
create policy notifications_own_read on notifications for select using (user_id = (select auth.uid()));
drop policy if exists notifications_own_update on notifications;
create policy notifications_own_update on notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists notifications_own_delete on notifications;
create policy notifications_own_delete on notifications for delete to authenticated using (user_id = (select auth.uid()));
revoke insert on notifications from anon, authenticated;

-- Watches follow merges.
create or replace function radar_watches_follow_merge()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into radar_watches (user_id, track_id, created_at)
  select w.user_id, new.new_track_id, w.created_at from radar_watches w where w.track_id = new.old_track_id
  on conflict do nothing;
  return new;
end;
$$;
drop trigger if exists radar_watches_follow_merge on track_redirects;
create trigger radar_watches_follow_merge before insert on track_redirects
for each row execute function radar_watches_follow_merge();

-- Status changes -> notifications for watchers and collectors.
create or replace function sc_notify_status_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  t record;
begin
  if new.to_status is not distinct from new.from_status then return null; end if;
  select tr.id, tr.title, a.name artist into t from tracks tr join artists a on a.id = tr.artist_id where tr.id = new.track_id;
  if t.id is null then return null; end if;
  insert into notifications (user_id, kind, title, body, link, track_id, dedupe_key)
  select u.user_id, 'status',
         t.artist || ' · ' || t.title || ' is now ' || new.to_status,
         case when new.from_status is not null then 'Was ' || new.from_status || '.' end,
         '/song/' || t.id, t.id, 'status:' || t.id || ':' || new.to_status
  from (
    select user_id from radar_watches where track_id = t.id
    union
    select user_id from track_ownership
    where track_id = t.id and coalesce(new.from_status, 'unconfirmed') <> 'unconfirmed'
  ) u
  where u.user_id is distinct from new.created_by
  on conflict do nothing;
  return null;
end;
$$;
drop trigger if exists track_status_events_notify on track_status_events;
create trigger track_status_events_notify after insert on track_status_events
for each row execute function sc_notify_status_change();

-- Each morning: release days for watched songs, and tidy old notifications.
create or replace function sc_radar_daily()
returns int
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  n int;
begin
  insert into notifications (user_id, kind, title, body, link, track_id, dedupe_key)
  select w.user_id, 'release_day', a.name || ' · ' || t.title || ' is out today',
         case when t.album is not null then 'From ' || t.album || '.' end,
         '/song/' || t.id, t.id, 'release_day:' || t.id || ':' || t.release_date
  from radar_watches w join tracks t on t.id = w.track_id join artists a on a.id = t.artist_id
  where t.release_date = (now() at time zone 'Europe/London')::date
  on conflict do nothing;
  get diagnostics n = row_count;
  delete from notifications where created_at < now() - interval '90 days';
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reading
-- ---------------------------------------------------------------------------

-- The radar: upcoming (dated), announced with no date, and just dropped
-- (released in the last 14 days or moved off "announced" recently).
create or replace function rpc_release_radar()
returns table (section text, track_id text, title text, artist_id text, artist text, album text,
               release_date date, status text, spotify_url text, watchers bigint, watching boolean)
language sql
stable
security definer
set search_path to 'public'
as $$
  with today as (select (now() at time zone 'Europe/London')::date d),
  picked as (
    select case
             when t.release_date >= today.d then 'upcoming'
             when t.release_status = 'announced' then 'tba'
             else 'dropped'
           end section, t.*
    from tracks t, today
    where t.parent_track_id is null and t.release_status <> 'removed'
      and (t.release_date >= today.d
           or (t.release_status = 'announced' and t.release_date is null)
           or (t.release_date between today.d - 14 and today.d - 1 and t.release_status in ('released', 'leaked'))
           or exists (select 1 from track_status_events e where e.track_id = t.id and e.from_status = 'announced'
                      and e.created_at > now() - interval '14 days'))
  )
  select p.section, p.id, p.title, p.artist_id, a.name, p.album, p.release_date, p.release_status, p.spotify_url,
         (select count(*) from radar_watches w where w.track_id = p.id),
         exists (select 1 from radar_watches w where w.track_id = p.id and w.user_id = auth.uid())
  from picked p join artists a on a.id = p.artist_id
  order by case p.section when 'upcoming' then 0 when 'tba' then 1 else 2 end,
           case when p.section = 'dropped' then null else p.release_date end nulls last,
           p.release_date desc nulls last, a.name, p.album nulls last, p.track_number nulls last, p.title
  limit 500;
$$;

create or replace function rpc_my_notifications(p_limit int default 50)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select jsonb_build_object(
    'unread', (select count(*) from notifications where user_id = auth.uid() and read_at is null),
    'items', (select coalesce(jsonb_agg(to_jsonb(n) order by n.created_at desc), '[]'::jsonb) from (
       select id, kind, title, body, link, created_at, read_at from notifications
       where user_id = auth.uid() order by created_at desc limit greatest(1, least(coalesce(p_limit, 50), 200))) n));
$$;

create or replace function rpc_unread_notifications()
returns int
language sql
stable
security definer
set search_path to 'public'
as $$
  select count(*)::int from notifications where user_id = auth.uid() and read_at is null;
$$;

create or replace function rpc_mark_notifications_read(p_ids uuid[] default null)
returns void
language sql
security definer
set search_path to 'public'
as $$
  update notifications set read_at = now()
  where user_id = auth.uid() and read_at is null and (p_ids is null or id = any (p_ids));
$$;

revoke execute on function radar_watches_follow_merge(), sc_notify_status_change(), sc_radar_daily() from public, anon, authenticated;
revoke execute on function rpc_release_radar(), rpc_my_notifications(int), rpc_unread_notifications(),
  rpc_mark_notifications_read(uuid[]) from public;
grant execute on function rpc_release_radar() to anon, authenticated;
grant execute on function rpc_my_notifications(int), rpc_unread_notifications(), rpc_mark_notifications_read(uuid[]) to authenticated;

-- Morning check, 07:05 UTC.
select cron.unschedule('radar-daily') where exists (select 1 from cron.job where jobname = 'radar-daily');
select cron.schedule('radar-daily', '5 7 * * *', $job$ select public.sc_radar_daily(); $job$);
