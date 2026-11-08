-- The contributors board took 1.5 s (up to 8 s) on every home and
-- contributors page view. Work it out every 10 minutes instead and read that.
alter function rpc_top_contributors(int, int) rename to rpc_top_contributors_live;
revoke execute on function rpc_top_contributors_live(int, int) from public, anon, authenticated;

create table if not exists top_contributors_cache (
  period text primary key,      -- '30' or 'all'
  rows jsonb not null,
  refreshed_at timestamptz not null default now()
);
alter table top_contributors_cache enable row level security;

create or replace function sc_top_contributors_refresh()
returns void language sql security definer set search_path to 'public' as $$
  insert into top_contributors_cache (period, rows, refreshed_at)
  select p, (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from rpc_top_contributors_live(case when p = '30' then 30 end, 200) x), now()
  from unnest(array['30', 'all']) p
  on conflict (period) do update set rows = excluded.rows, refreshed_at = excluded.refreshed_at;
$$;
revoke execute on function sc_top_contributors_refresh() from public, anon, authenticated;
select sc_top_contributors_refresh();

create or replace function rpc_top_contributors(p_days integer default 30, p_limit integer default 50)
returns table(user_id uuid, display_name text, avatar_url text, total bigint, songs bigint, versions bigint, status bigint, corrections bigint, finds bigint, confirmations bigint)
language sql stable security definer set search_path to 'public' as $$
  select r.user_id, r.display_name, r.avatar_url, r.total, r.songs, r.versions, r.status, r.corrections, r.finds, r.confirmations
  from top_contributors_cache c,
       jsonb_to_recordset(c.rows) as r(user_id uuid, display_name text, avatar_url text, total bigint, songs bigint, versions bigint,
                                       status bigint, corrections bigint, finds bigint, confirmations bigint)
  where c.period = case when p_days = 30 then '30' when p_days is null then 'all' end
  union all
  -- Any other period: worked out live.
  select * from rpc_top_contributors_live(p_days, p_limit) where p_days is not null and p_days <> 30
  order by 4 desc, 2
  limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;
grant execute on function rpc_top_contributors(int, int) to anon, authenticated;

select cron.schedule('top-contributors', '*/10 * * * *', $$ select public.sc_top_contributors_refresh(); $$);

alter function sc_credit_fields set search_path to 'public';
