-- The collab map worked its data out on every visit (graph ~0.4 s, scenes
-- and recent collabs ~0.9 s). Keep the results in a table, refreshed hourly.
create table if not exists collab_cache (key text primary key, data jsonb not null, updated_at timestamptz not null default now());
alter table collab_cache enable row level security;

alter function rpc_collab_extras() rename to sc_collab_extras_build;
create or replace function sc_collab_graph_build() returns jsonb language sql stable security definer set search_path to 'public' as $$
  select rpc_collab_graph(null);
$$;
create or replace function sc_collab_cache_refresh() returns void language plpgsql security definer set search_path to 'public' as $$
begin
  insert into collab_cache (key, data, updated_at) values ('graph', sc_collab_graph_build(), now())
    on conflict (key) do update set data = excluded.data, updated_at = now();
  insert into collab_cache (key, data, updated_at) values ('extras', sc_collab_extras_build(), now())
    on conflict (key) do update set data = excluded.data, updated_at = now();
end $$;
create or replace function rpc_collab_extras() returns jsonb language sql stable security definer set search_path to 'public' as $$
  select coalesce((select data from collab_cache where key = 'extras'), sc_collab_extras_build());
$$;
create or replace function rpc_collab_graph_cached() returns jsonb language sql stable security definer set search_path to 'public' as $$
  select coalesce((select data from collab_cache where key = 'graph'), rpc_collab_graph(null));
$$;
grant execute on function rpc_collab_extras() to anon, authenticated;
grant execute on function rpc_collab_graph_cached() to anon, authenticated;
revoke execute on function sc_collab_extras_build() from public, anon, authenticated;
revoke execute on function sc_collab_graph_build() from public, anon, authenticated;
revoke execute on function sc_collab_cache_refresh() from public, anon, authenticated;
select sc_collab_cache_refresh();
select cron.schedule('collab-cache', '13 * * * *', 'select public.sc_collab_cache_refresh()');
