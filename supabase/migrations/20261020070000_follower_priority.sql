-- Interest first.
--
-- 1. Artist queue (what gets checked for new music next): followers now
--    count for much more, and the "new / empty page / never checked" boosts
--    only apply in full to artists someone follows or has asked about. New
--    pages nobody follows (like guest artists) still get checked, just after
--    the ones people care about.
-- 2. Spotify link matching works through songs by followed artists first
--    (most followers first) instead of in database order.

create or replace function sc_artist_queue(p_limit integer default 50, p_only_due boolean default true)
returns table (artist_id text, name text, score numeric, due boolean, next_due_at timestamptz, track_count bigint,
               followers bigint, requests bigint, last_checked_at timestamptz, quiet_streak integer, reasons text[])
language sql
stable
security definer
set search_path to 'public'
as $$
  with base as (
    select a.id, a.name,
      (select count(*) from tracks t where t.artist_id = a.id) as n_tracks,
      (select count(*) from follows f where f.artist_id = a.id) as n_followers,
      (select count(*) from artist_requests r where r.artist_id = a.id and r.created_at > now() - interval '30 days') as n_requests,
      rs.last_researched_at, rs.next_due_at, coalesce(rs.quiet_streak, 0) as streak, rs.last_found_at
    from artists a
    left join artist_research_state rs on rs.artist_id = a.id
  ),
  scored as (
    select b.*,
      -- Interest: followers (1 = 28, 3 = 55, 10 = 96 points) and requests.
      (round(40 * ln(1 + b.n_followers)::numeric, 1)
       + least(b.n_requests, 10) * 20
       -- Thin or never-checked pages: full boost when someone's interested,
       -- a quarter otherwise.
       + (case when b.n_tracks = 0 then 40 when b.n_tracks <= 10 then 25 when b.n_tracks <= 50 then 8 else 0 end
          + case when b.last_researched_at is null then 15 else 0 end)
         * case when b.n_followers > 0 or b.n_requests > 0 then 1 else 0.25 end
       + case when b.last_found_at > now() - interval '14 days' then 25 else 0 end
       -- Overdue artists creep up the longer they wait.
       + least(greatest(extract(epoch from (now() - coalesce(b.next_due_at, now()))) / 86400.0, 0), 30)
      )::numeric as score,
      (b.next_due_at is null or b.next_due_at <= now()) as is_due
    from base b
  )
  select s.id, s.name, s.score, s.is_due, s.next_due_at, s.n_tracks, s.n_followers, s.n_requests,
    s.last_researched_at, s.streak,
    array_remove(array[
      case when s.n_followers > 0 then s.n_followers || ' follower' || case when s.n_followers = 1 then '' else 's' end end,
      case when s.n_requests > 0 then s.n_requests || ' request' || case when s.n_requests = 1 then '' else 's' end end,
      case when s.n_tracks = 0 then 'empty page' when s.n_tracks <= 10 then 'only ' || s.n_tracks || case when s.n_tracks = 1 then ' song' else ' songs' end end,
      case when s.last_researched_at is null then 'never checked' end,
      case when s.last_found_at > now() - interval '14 days' then 'new music found recently' end,
      case when s.streak >= 2 then 'quiet (' || s.streak || ' checks with nothing new)' end,
      case when not s.is_due then 'next check ' || to_char(s.next_due_at at time zone 'Europe/London', 'DD Mon HH24:MI') end
    ], null)
  from scored s
  where (not p_only_due or s.is_due)
  order by s.is_due desc, s.score desc, s.last_researched_at nulls first
  limit greatest(1, least(coalesce(p_limit, 50), 500));
$$;

-- Next songs for Spotify matching: artists with the most followers first,
-- taking turns between artists (one song each, round and round) so one big
-- catalogue doesn't hold everyone else up. Main songs before versions.
create or replace function sc_spotify_match_next(p_limit int default 10)
returns table (id text, title text, release_status text, album text, release_date date, artist text, others text[])
language sql
stable
security definer
set search_path to 'public'
as $$
  with fans as (
    select artist_id, count(*) n from follows group by artist_id
  ), todo as (
    select t.id, t.title, t.release_status, t.album, t.release_date, t.artist_id,
           row_number() over (partition by t.artist_id order by (t.parent_track_id is null) desc, t.id) turn
    from tracks t
    where t.spotify_url is null and t.spotify_search_attempted_at is null
  )
  select d.id, d.title, d.release_status, d.album, d.release_date, a.name,
         array(select a2.name from track_appearances ap join artists a2 on a2.id = ap.artist_id where ap.track_id = d.id)
  from todo d
  join artists a on a.id = d.artist_id
  left join fans f on f.artist_id = d.artist_id
  order by (coalesce(f.n, 0) > 0) desc, d.turn, coalesce(f.n, 0) desc, d.artist_id
  limit greatest(1, least(coalesce(p_limit, 10), 50));
$$;
revoke execute on function sc_spotify_match_next(int) from public, anon, authenticated;
grant execute on function sc_spotify_match_next(int) to service_role;

select name, round(score) score, followers, reasons from sc_artist_queue(8, false);
