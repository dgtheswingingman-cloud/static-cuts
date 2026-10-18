-- "What's new" feed (/new).
--
-- Songs added and status changes (snippet -> leaked, leaked -> released...),
-- grouped per artist per day so a big import shows as one entry instead of
-- hundreds. Returned a few days at a time, newest first.
--
--   p_before     only days before this one (null = from today)
--   p_kind       'all', 'added' or 'status'
--   p_following  only artists the viewer follows
--   p_days       how many days with activity to return (max 7)
--
-- Returns {days: [{day, groups: [{kind, artist_id, artist, to_status,
-- count, at, tracks: [{id, title, from}]}]}], next: <day or null>}.

create index if not exists tracks_created_at_idx on tracks (created_at desc) where created_at is not null;
create index if not exists track_status_events_created_idx on track_status_events (created_at desc);

create or replace function rpc_whats_new(p_before date default null, p_kind text default 'all',
                                         p_following boolean default false, p_days int default 3)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  with lim as (
    select coalesce(p_before, (now() at time zone 'Europe/London')::date + 1)::timestamp at time zone 'Europe/London' as before_at,
           auth.uid() as me
  ),
  ev as (
    -- Look back at most 90 days per page.
    select 'added'::text kind, t.artist_id, t.created_at ts, null::text to_status, null::text from_status, t.id, t.title
    from tracks t, lim
    where p_kind in ('all', 'added') and t.created_at < lim.before_at and t.created_at >= lim.before_at - interval '90 days'
      and (not p_following or exists (select 1 from follows f where f.user_id = lim.me and f.artist_id = t.artist_id))
    union all
    select 'status', t.artist_id, e.created_at, e.to_status, e.from_status, t.id, t.title
    from track_status_events e join tracks t on t.id = e.track_id, lim
    where p_kind in ('all', 'status') and e.created_at < lim.before_at and e.created_at >= lim.before_at - interval '90 days'
      and e.to_status is distinct from e.from_status
      and (not p_following or exists (select 1 from follows f where f.user_id = lim.me and f.artist_id = t.artist_id))
  ),
  dated as (
    select ev.*, (ev.ts at time zone 'Europe/London')::date as day from ev
  ),
  days as (
    select distinct day from dated order by day desc limit greatest(1, least(coalesce(p_days, 3), 7))
  ),
  grp as (
    select d.day, d.kind, d.artist_id, d.to_status, count(*) n, max(d.ts) last_at,
           to_jsonb((array_agg(jsonb_build_object('id', d.id, 'title', d.title, 'from', d.from_status) order by d.ts desc))[1:5]) tracks
    from dated d where d.day in (select day from days)
    group by d.day, d.kind, d.artist_id, d.to_status
  ),
  per_day as (
    select g.day, jsonb_agg(jsonb_build_object(
             'kind', g.kind, 'artist_id', g.artist_id, 'artist', a.name, 'to_status', g.to_status,
             'count', g.n, 'at', g.last_at, 'tracks', g.tracks) order by g.last_at desc) groups
    from grp g left join artists a on a.id = g.artist_id
    group by g.day
  )
  select jsonb_build_object(
    'days', coalesce((select jsonb_agg(jsonb_build_object('day', day, 'groups', groups) order by day desc) from per_day), '[]'::jsonb),
    'next', (select min(day) from days where exists (select 1 from dated where dated.day < (select min(day) from days))));
$$;

revoke execute on function rpc_whats_new(date, text, boolean, int) from public;
grant execute on function rpc_whats_new(date, text, boolean, int) to anon, authenticated;
