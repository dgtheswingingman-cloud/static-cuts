-- The database (Micro: 1 GB memory) only gave each sort 2 MB, so bigger jobs
-- spilled to disk: gigabytes of temporary writes a day since Deezer grew the
-- song list, which used up the disk allowance and slowed everything down.

-- More room for the site's API connections and the timers (new connections
-- pick this up).
alter role authenticator set work_mem = '12MB';
alter role postgres set work_mem = '12MB';

-- The heavy background jobs get more again (they run one at a time).
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'sc_refresh_duplicate_candidates', 'find_duplicate_groups', 'find_identical_duplicates',
      'sc_refresh_leaderboard', 'rpc_user_contributions', 'sc_genius_credit_next', 'rpc_search_songs')
  loop
    execute format('alter function %s set work_mem = %L', f.sig,
      case when f.proname in ('sc_refresh_duplicate_candidates', 'find_duplicate_groups', 'find_identical_duplicates') then '64MB' else '32MB' end);
  end loop;
end $$;

-- The homepage background refresh only keeps the feed the homepage uses
-- (other views are quick to work out when asked for).
create or replace function sc_home_cache_refresh()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  k text;
begin
  foreach k in array array['whats_new:all:2', 'whats_new:all:3'] loop
    insert into home_cache (key, data, refreshed_at)
    values (k, sc_whats_new_live(null, 'all', false, split_part(k, ':', 3)::int), now())
    on conflict (key) do update set data = excluded.data, refreshed_at = excluded.refreshed_at;
  end loop;
end;
$$;
revoke execute on function sc_home_cache_refresh() from public, anon, authenticated;

-- Every 5 minutes is plenty (visitors get a copy up to 10 minutes old).
select cron.schedule('home-cache', '*/5 * * * *', 'select sc_home_cache_refresh()');
