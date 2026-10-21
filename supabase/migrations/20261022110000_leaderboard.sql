-- Leaderboard: contributors ranked by points. Different contributions are
-- worth different amounts:
--   new song 10 · find (first to spot something new) 8 · version 5 ·
--   status update 4 · edit or link fix 3 · confirming someone's find 2
-- The team (owner, admins, moderators) is left off: bulk imports and
-- approvals count as theirs and would bury everyone else. People who've
-- hidden their contributions (privacy settings) are left off too.
-- Worked out once an hour (counting every contribution takes about a
-- second), for this month and for all time.

create table if not exists leaderboard_cache (
  period text not null check (period in ('month', 'all')),
  rank bigint not null,
  user_id uuid not null,
  points bigint not null,
  songs bigint not null default 0,
  versions bigint not null default 0,
  status bigint not null default 0,
  corrections bigint not null default 0,
  finds bigint not null default 0,
  confirmations bigint not null default 0,
  primary key (period, user_id)
);
alter table leaderboard_cache enable row level security;
revoke all on leaderboard_cache from anon, authenticated;

create or replace function sc_refresh_leaderboard()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_n int;
begin
  create temp table _lb on commit drop as
  with periods(period, since) as (values ('month', now() - interval '30 days'), ('all', null::timestamptz)),
  ev as (
    select p.period, e.user_id, e.kind
    from periods p, sc_contribution_events(null, p.since) e
  ),
  per as (
    select ev.period, ev.user_id,
           sum(case ev.kind when 'song' then 10 when 'find' then 8 when 'version' then 5 when 'status' then 4
                            when 'correction' then 3 when 'confirmation' then 2 else 0 end) as points,
           count(*) filter (where ev.kind = 'song') songs, count(*) filter (where ev.kind = 'version') versions,
           count(*) filter (where ev.kind = 'status') status, count(*) filter (where ev.kind = 'correction') corrections,
           count(*) filter (where ev.kind = 'find') finds, count(*) filter (where ev.kind = 'confirmation') confirmations
    from ev
    where not exists (select 1 from moderators m where m.user_id = ev.user_id)
      and not exists (select 1 from auth.users u where u.id = ev.user_id and u.email = 'dg.theswingingman@gmail.com')
    group by ev.period, ev.user_id
  )
  select per.period, rank() over (partition by per.period order by per.points desc) as rank, per.user_id, per.points,
         per.songs, per.versions, per.status, per.corrections, per.finds, per.confirmations
  from per
  where per.points > 0;
  delete from leaderboard_cache;
  insert into leaderboard_cache (period, rank, user_id, points, songs, versions, status, corrections, finds, confirmations)
  select period, rank, user_id, points, songs, versions, status, corrections, finds, confirmations from _lb;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke execute on function sc_refresh_leaderboard() from public, anon, authenticated;

select sc_refresh_leaderboard() as leaderboard_rows;

-- p_days 30 = this month, null = all time.
create or replace function rpc_leaderboard(p_days int default 30, p_limit int default 10)
returns table (
  rank bigint, user_id uuid, display_name text, avatar_url text, points bigint,
  songs bigint, versions bigint, status bigint, corrections bigint, finds bigint, confirmations bigint
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select l.rank, l.user_id, p.display_name, p.avatar_url, l.points,
         l.songs, l.versions, l.status, l.corrections, l.finds, l.confirmations
  from leaderboard_cache l join profiles p on p.id = l.user_id
  where l.period = case when p_days is null then 'all' else 'month' end
    and p.show_contributions
  order by l.points desc, p.display_name
  limit greatest(1, least(coalesce(p_limit, 10), 100));
$$;
grant execute on function rpc_leaderboard(int, int) to anon, authenticated;

select cron.schedule('leaderboard-refresh', '23 * * * *', $$ select public.sc_refresh_leaderboard(); $$);
