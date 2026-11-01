-- Two fixes:
--
-- 1. Homepage feed: since 20261101030000 the feed's saved copy isn't redone
--    when no songs changed, but the homepage only used a copy under 10
--    minutes old, so it fell back to working the feed out live (~2 s) for
--    every visitor. When nothing changed, the saved copy is now marked
--    fresh again instead.
-- 2. Collabs page: looking up each guest's name re-read every connection
--    for every point on the graph (6 s, over the 3 s limit for people who
--    aren't logged in). Names are now gathered in the same single pass.

create or replace function sc_home_cache_refresh()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  k text;
begin
  if not sc_job_due('home', interval '30 minutes') then
    -- Nothing added or removed: what's saved is still right.
    update home_cache set refreshed_at = now() where key in ('whats_new:all:2', 'whats_new:all:3');
    return;
  end if;
  foreach k in array array['whats_new:all:2', 'whats_new:all:3'] loop
    insert into home_cache (key, data, refreshed_at)
    values (k, sc_whats_new_live(null, 'all', false, split_part(k, ':', 3)::int), now())
    on conflict (key) do update set data = excluded.data, refreshed_at = excluded.refreshed_at;
  end loop;
end;
$$;

create or replace function rpc_collab_graph(p_artist text default null)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  with filtered as (
    select * from collab_edges where p_artist is null or x = p_artist or y = p_artist
  ),
  nodes as (
    select k, count(*) degree, sum(songs) songs, max(guest_name) guest_name from (
      select x k, songs, guest_name from filtered union all select y, songs, guest_name from filtered) z group by k
  )
  select jsonb_build_object(
    'nodes', (select coalesce(jsonb_agg(jsonb_build_object(
                'key', n.k, 'artist_id', a.id,
                'name', coalesce(a.name, n.guest_name, substr(n.k, 7)),
                'degree', n.degree, 'songs', n.songs)), '[]'::jsonb)
              from nodes n left join artists a on a.id = n.k),
    'edges', (select coalesce(jsonb_agg(jsonb_build_object('a', x, 'b', y, 'songs', songs, 'tracks', tracks)), '[]'::jsonb) from filtered),
    'updated_at', now());
$$;

select sc_home_cache_refresh();
