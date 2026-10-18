-- Daily summary for artists you follow, plus notification settings.
--
-- Each morning (with the release-radar check, 07:05 UTC) everyone who follows
-- artists gets one notification summing up the last day for them: songs
-- that leaked, released, got snippets, were announced or teased, and how
-- many new songs were added. Routine "unconfirmed -> released" link matching
-- isn't counted. Nothing happened = no notification.
--
-- Settings (on /settings, both on by default):
--   notify_followed_daily  the daily summary above
--   notify_collected       status changes on songs you've collected
-- ("Remind me" notifications always come; that's what remind me is for.)

alter table profiles add column if not exists notify_followed_daily boolean not null default true;
alter table profiles add column if not exists notify_collected boolean not null default true;

-- Collected-song notifications respect the setting.
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
    select o.user_id from track_ownership o join profiles p on p.id = o.user_id
    where o.track_id = t.id and p.notify_collected and coalesce(new.from_status, 'unconfirmed') <> 'unconfirmed'
  ) u
  where u.user_id is distinct from new.created_by
  on conflict do nothing;
  return null;
end;
$$;

-- The daily summary.
create or replace function sc_follow_digest()
returns int
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  n int;
begin
  with changes as (
    select t.artist_id, e.to_status, count(*) c
    from track_status_events e join tracks t on t.id = e.track_id
    where e.created_at > now() - interval '24 hours'
      and e.to_status in ('leaked', 'released', 'snippet', 'announced', 'teased')
      and not (coalesce(e.from_status, 'unconfirmed') = 'unconfirmed' and e.to_status = 'released')
      and t.parent_track_id is null
    group by 1, 2
  ),
  added as (
    select artist_id, count(*) c from tracks
    where created_at > now() - interval '24 hours' and parent_track_id is null
    group by 1
  ),
  per_artist as (
    select a.id artist_id, a.name,
           concat_ws(', ',
             (select string_agg(c || ' ' || to_status, ', ' order by c desc) from changes ch where ch.artist_id = a.id),
             (select c || ' new song' || case when c = 1 then '' else 's' end from added ad where ad.artist_id = a.id)) summary,
           coalesce((select sum(c) from changes ch where ch.artist_id = a.id), 0)
             + coalesce((select c from added ad where ad.artist_id = a.id), 0) weight
    from artists a
    where exists (select 1 from changes ch where ch.artist_id = a.id) or exists (select 1 from added ad where ad.artist_id = a.id)
  ),
  per_user as (
    select f.user_id,
           string_agg(pa.name || ': ' || pa.summary, ' · ' order by pa.weight desc) body,
           count(*) artists,
           (array_agg(pa.name order by pa.weight desc))[1] top
    from follows f join per_artist pa on pa.artist_id = f.artist_id
    join profiles p on p.id = f.user_id and p.notify_followed_daily
    group by f.user_id
  )
  insert into notifications (user_id, kind, title, body, link, dedupe_key)
  select user_id, 'digest',
         case when artists = 1 then 'Yesterday for ' || top
              else 'Yesterday for ' || top || ' and ' || (artists - 1) || ' more you follow' end,
         left(body, 600), '/new', 'digest:' || (now() at time zone 'Europe/London')::date
  from per_user
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function sc_follow_digest() from public, anon, authenticated;

-- Run it with the morning radar check.
select cron.unschedule('follow-digest') where exists (select 1 from cron.job where jobname = 'follow-digest');
select cron.schedule('follow-digest', '7 7 * * *', $job$ select public.sc_follow_digest(); $job$);
