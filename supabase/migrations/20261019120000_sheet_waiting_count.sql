-- The sheets list also shows how many of each sheet's songs are waiting in
-- the imported songs review list.

drop function if exists rpc_sheet_sources();
create or replace function rpc_sheet_sources()
returns table (id uuid, title text, tab_name text, credit text, url text, artist_id text, artist text,
               songs bigint, created_at timestamptz, last_synced_at timestamptz, auto_sync boolean, next_check_at timestamptz,
               waiting bigint)
language sql
stable
security definer
set search_path to 'public'
as $$
  select s.id, s.title, s.tab_name, s.credit, s.url, s.artist_id, a.name,
         (select count(*) from tracks t where t.source = 'sheet' and t.source_url = s.url),
         s.created_at, s.last_synced_at, s.auto_sync, s.next_check_at,
         (select count(*) from import_suggestions g where g.source = 'sheet' and g.url = s.url and g.state = 'open')
  from sheet_sources s join artists a on a.id = s.artist_id
  order by a.name, s.title;
$$;
grant execute on function rpc_sheet_sources() to anon, authenticated;
