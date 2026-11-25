-- Control room, Work tab: a progress card per launch artist (the main
-- artists), so the content push can be seen week by week. For each artist,
-- main songs only:
--   status  songs with a status (not "unconfirmed")
--   link    released / leaked / snippet songs with a listen link
--   date    leaked songs with a leak date
--   era     unreleased songs (anything not released) with an era
-- A snapshot is kept every night (NIX timer "launch-progress") so the card
-- can show the change over the last 7 days.

create table if not exists public.launch_progress_days (
  day date not null,
  artist_id text not null,
  data jsonb not null,
  primary key (day, artist_id)
);
alter table public.launch_progress_days enable row level security;

create or replace function public.sc_launch_progress_now()
returns table (artist_id text, data jsonb)
language sql stable security definer set search_path = public as $$
  select l.artist_id, jsonb_build_object(
    'songs', count(t.id),
    'status', count(t.id) filter (where coalesce(t.release_status, 'unconfirmed') <> 'unconfirmed'),
    'link_of', count(t.id) filter (where t.release_status in ('released', 'leaked', 'snippet')),
    'link', count(t.id) filter (where t.release_status in ('released', 'leaked', 'snippet') and t.spotify_url is not null),
    'date_of', count(t.id) filter (where t.release_status = 'leaked'),
    'date', count(t.id) filter (where t.release_status = 'leaked' and t.leak_date is not null),
    'era_of', count(t.id) filter (where coalesce(t.release_status, 'unconfirmed') <> 'released'),
    'era', count(t.id) filter (where coalesce(t.release_status, 'unconfirmed') <> 'released' and nullif(t.album, '') is not null))
  from launch_artists l left join tracks t on t.artist_id = l.artist_id and t.parent_track_id is null
  group by l.artist_id
$$;
revoke all on function public.sc_launch_progress_now() from public, anon, authenticated;

create or replace function public.sc_launch_progress_snapshot() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into launch_progress_days (day, artist_id, data)
  select current_date, p.artist_id, p.data from sc_launch_progress_now() p
  on conflict (day, artist_id) do update set data = excluded.data;
  get diagnostics n = row_count;
  delete from launch_progress_days where day < current_date - 120;
  return n;
end $$;
revoke all on function public.sc_launch_progress_snapshot() from public, anon, authenticated;

create or replace function public.admin_launch_progress()
returns jsonb
language sql stable security definer set search_path = public as $$
  select case when is_moderator() then coalesce(jsonb_agg(jsonb_build_object(
      'artist_id', p.artist_id, 'name', a.name, 'photo', a.image_url, 'now', p.data,
      'then', b.data, 'then_day', b.day) order by l.position nulls last, a.name), '[]') end
  from sc_launch_progress_now() p
  join launch_artists l on l.artist_id = p.artist_id
  join artists a on a.id = p.artist_id
  left join lateral (
    select d.day, d.data from launch_progress_days d
    where d.artist_id = p.artist_id and d.day between current_date - 7 and current_date - 1
    order by d.day limit 1) b on true
$$;
grant execute on function public.admin_launch_progress() to authenticated;

insert into public.nix_tasks (name, every, max_every, at_time, next_at, enabled, steps)
values ('launch-progress', '1 day', '1 day', '23:47:00', current_date + time '23:47', true,
        '[{"name":"artists","sql":"public.sc_launch_progress_snapshot()"}]')
on conflict (name) do update set steps = excluded.steps, at_time = excluded.at_time, enabled = true;

select public.sc_launch_progress_snapshot();
