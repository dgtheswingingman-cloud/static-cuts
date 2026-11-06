-- First-time visitor home page: headline numbers (refreshed hourly) and the
-- launch artists with their photos and song counts.
create table if not exists site_cache (key text primary key, data jsonb not null, updated_at timestamptz not null default now());
alter table site_cache enable row level security;

create or replace function sc_visitor_stats_refresh() returns void
language plpgsql security definer set search_path to 'public' set statement_timeout to '120s' as $$
begin
  insert into site_cache (key, data, updated_at)
  select 'visitor_stats', jsonb_build_object(
    'artists', (select count(*) from artists),
    'songs', (select count(*) from tracks where parent_track_id is null),
    'versions', (select count(*) from tracks where parent_track_id is not null),
    'unreleased', (select count(*) from tracks where release_status in ('leaked', 'snippet', 'teased', 'announced', 'rumored')),
    'leaked_week', (select count(*) from tracks where release_status = 'leaked' and leak_date >= current_date - 7),
    'albums', (select count(distinct album_id) from album_tracks),
    'contributors', (select count(distinct user_id) from track_credits)), now()
  on conflict (key) do update set data = excluded.data, updated_at = now();
end $$;
revoke execute on function sc_visitor_stats_refresh() from public, anon, authenticated;

create or replace function rpc_visitor_home() returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'stats', (select data from site_cache where key = 'visitor_stats'),
    'artists', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'image', a.image_url, 'songs', coalesce(c.n, 0)) order by x.ord), '[]'::jsonb)
                from unnest(array['playboi-carti','ken-carson','destroy-lonely','hxg','bladee','ecco2k','thaiboy-digital','zillakami','sosmula','city-morgue']) with ordinality x(id, ord)
                join artists a on a.id = x.id left join artist_track_counts c on c.artist_id = a.id));
$$;
grant execute on function rpc_visitor_home() to anon, authenticated;
select sc_visitor_stats_refresh();
select cron.schedule('visitor-stats', '29 * * * *', 'select public.sc_visitor_stats_refresh()');

-- The public contributor lists leave out the owner and moderators, like the
-- leaderboard already does.
do $do$
declare d text;
begin
  d := pg_get_functiondef('rpc_top_contributors'::regproc);
  if position('moderators m' in d) = 0 then
    d := regexp_replace(d, 'where p\.show_contributions(\s+)group by', 'where p.show_contributions and not exists (select 1 from moderators m where m.user_id = e.user_id) and not exists (select 1 from auth.users u where u.id = e.user_id and u.email = ''dg.theswingingman@gmail.com'')\1group by');
    execute d;
  end if;
end $do$;
