-- The homepage "What's new" got slow (11 s) after Deezer added ~140k songs in
-- a few days: it read every song from the last 90 days before picking days.
-- 1. Find the days first (a few quick index look-ups), then only read those
--    days, and build the song list only for the 5 newest per group.
-- 2. The homepage feed is refreshed in the background every 2 minutes, so a
--    visitor never has to wait for it to be worked out.

create or replace function sc_whats_new_live(p_before date DEFAULT NULL::date, p_kind text DEFAULT 'all'::text, p_following boolean DEFAULT false, p_days integer DEFAULT 3)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
set work_mem to '32MB'
as $$
declare
  v_me uuid := auth.uid();
  v_before timestamptz := coalesce(p_before, (now() at time zone 'Europe/London')::date + 1)::timestamp at time zone 'Europe/London';
  v_floor timestamptz;
  v_cur timestamptz;
  v_ts timestamptz;
  v_day date;
  v_days date[] := '{}';
  v_want int := greatest(1, least(coalesce(p_days, 3), 7));
  v_next date;
  v_added boolean := coalesce(p_kind, 'all') in ('all', 'added');
  v_status boolean := coalesce(p_kind, 'all') in ('all', 'status');
  v_follow boolean := coalesce(p_following, false);
  v_out jsonb;
begin
  v_floor := v_before - interval '90 days';
  v_cur := v_before;

  -- The newest event before a time (songs added, or status changes).
  -- Walks back one day at a time; at most 8 rounds.
  loop
    v_ts := greatest(
      case when v_added and not v_follow then
        (select max(t.created_at) from tracks t where t.created_at < v_cur and t.created_at >= v_floor) end,
      case when v_added and v_follow then
        (select max(x.created_at) from follows f
           cross join lateral (select t.created_at from tracks t
                               where t.artist_id = f.artist_id and t.created_at < v_cur and t.created_at >= v_floor
                               order by t.created_at desc limit 1) x
          where f.user_id = v_me) end,
      case when v_status then
        (select max(e.created_at) from track_status_events e join tracks t on t.id = e.track_id
          where e.created_at < v_cur and e.created_at >= v_floor and e.to_status is distinct from e.from_status
            and (not v_follow or exists (select 1 from follows f where f.user_id = v_me and f.artist_id = t.artist_id))) end);
    exit when v_ts is null;
    v_day := (v_ts at time zone 'Europe/London')::date;
    if cardinality(v_days) >= v_want then v_next := v_days[cardinality(v_days)]; exit; end if;
    v_days := v_days || v_day;
    v_cur := v_day::timestamp at time zone 'Europe/London';
  end loop;

  if cardinality(v_days) = 0 then
    return jsonb_build_object('days', '[]'::jsonb, 'next', null);
  end if;

  -- Songs added: counted from the index, then the 5 newest per artist and day.
  -- Status changes are few, so they're worked out directly.
  with added as (
    select (t.created_at at time zone 'Europe/London')::date as day, t.artist_id, count(*) n, max(t.created_at) last_at
    from tracks t
    where v_added and t.created_at < v_before and t.created_at >= v_cur
      and (not v_follow or exists (select 1 from follows f where f.user_id = v_me and f.artist_id = t.artist_id))
    group by 1, 2
  ),
  added_grp as (
    select a.day, 'added'::text kind, a.artist_id, null::text to_status, a.n, a.last_at,
           (select jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'from', null) order by x.created_at desc, x.id)
              from (select t.id, t.title, t.created_at from tracks t
                    where t.artist_id = a.artist_id
                      and t.created_at >= (a.day::timestamp at time zone 'Europe/London')
                      and t.created_at < ((a.day + 1)::timestamp at time zone 'Europe/London')
                    order by t.created_at desc, t.id limit 5) x) tracks
    from added a
  ),
  st as (
    select (e.created_at at time zone 'Europe/London')::date as day, t.artist_id, e.to_status, e.from_status, e.created_at ts, t.id, t.title,
           row_number() over w rn, count(*) over w n, max(e.created_at) over w last_at
    from track_status_events e join tracks t on t.id = e.track_id
    where v_status and e.created_at < v_before and e.created_at >= v_cur
      and e.to_status is distinct from e.from_status
      and (not v_follow or exists (select 1 from follows f where f.user_id = v_me and f.artist_id = t.artist_id))
    window w as (partition by (e.created_at at time zone 'Europe/London')::date, t.artist_id, e.to_status order by e.created_at desc, t.id
                 rows between unbounded preceding and unbounded following)
  ),
  status_grp as (
    select day, 'status'::text kind, artist_id, to_status, max(n) n, max(last_at) last_at,
           jsonb_agg(jsonb_build_object('id', id, 'title', title, 'from', from_status) order by ts desc, id) tracks
    from st where rn <= 5
    group by day, artist_id, to_status
  ),
  grp as (
    select * from added_grp union all select * from status_grp
  ),
  per_day as (
    select g.day, jsonb_agg(jsonb_build_object(
             'kind', g.kind, 'artist_id', g.artist_id, 'artist', a.name, 'to_status', g.to_status,
             'count', g.n, 'at', g.last_at, 'tracks', g.tracks) order by g.last_at desc, a.name, g.kind) groups
    from grp g left join artists a on a.id = g.artist_id
    group by g.day
  )
  select jsonb_build_object(
    'days', coalesce((select jsonb_agg(jsonb_build_object('day', day, 'groups', groups) order by day desc) from per_day), '[]'::jsonb),
    'next', v_next)
  into v_out;
  return v_out;
end;
$$;
revoke execute on function sc_whats_new_live(date, text, boolean, integer) from public, anon, authenticated;

-- Background refresh of the homepage feeds people have asked for lately.
create or replace function sc_home_cache_refresh()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  k record;
  v_kind text;
  v_days int;
begin
  for k in select key from home_cache where key like 'whats_new:%' and refreshed_at > now() - interval '1 day' loop
    v_kind := split_part(k.key, ':', 2);
    v_days := nullif(split_part(k.key, ':', 3), '')::int;
    update home_cache set data = sc_whats_new_live(null, v_kind, false, v_days), refreshed_at = now() where key = k.key;
  end loop;
end;
$$;
revoke execute on function sc_home_cache_refresh() from public, anon, authenticated;

-- Visitors get the background copy (up to 10 minutes old); only if there's
-- none is it worked out there and then.
create or replace function rpc_whats_new(p_before date DEFAULT NULL::date, p_kind text DEFAULT 'all'::text, p_following boolean DEFAULT false, p_days integer DEFAULT 3)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_key text;
  v_data jsonb;
begin
  -- Your own follows, or older pages: worked out each time.
  if p_before is not null or coalesce(p_following, false) then
    return sc_whats_new_live(p_before, p_kind, p_following, p_days);
  end if;
  v_key := 'whats_new:' || coalesce(p_kind, 'all') || ':' || coalesce(p_days, 3);
  select data into v_data from home_cache where key = v_key and refreshed_at > now() - interval '10 minutes';
  if v_data is not null then return v_data; end if;
  v_data := sc_whats_new_live(null, p_kind, false, p_days);
  insert into home_cache (key, data, refreshed_at) values (v_key, v_data, now())
  on conflict (key) do update set data = excluded.data, refreshed_at = excluded.refreshed_at;
  return v_data;
end;
$$;

select cron.schedule('home-cache', '*/2 * * * *', 'select sc_home_cache_refresh()');
