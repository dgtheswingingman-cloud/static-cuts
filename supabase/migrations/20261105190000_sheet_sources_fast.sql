-- The tracker list timed out (11 s) once tracks passed 300k: it counted each
-- sheet's songs one by one with no index. One grouped count, plus indexes.
create index if not exists tracks_sheet_source_url_idx on tracks (source_url) where source = 'sheet';
create index if not exists import_suggestions_sheet_open_url_idx on import_suggestions (url) where source = 'sheet' and state = 'open';
create or replace function rpc_sheet_sources()
returns table (id uuid, title text, tab_name text, credit text, url text, artist_id text, artist text,
               songs bigint, created_at timestamptz, last_synced_at timestamptz, auto_sync boolean, next_check_at timestamptz,
               waiting bigint)
language sql stable security definer set search_path to 'public'
as $$
  with t as (select source_url u, count(*) n from tracks where source = 'sheet' group by source_url),
       g as (select url u, count(*) n from import_suggestions where source = 'sheet' and state = 'open' group by url)
  select s.id, s.title, s.tab_name, s.credit, s.url, s.artist_id, a.name,
         coalesce(t.n, 0), s.created_at, s.last_synced_at, s.auto_sync, s.next_check_at, coalesce(g.n, 0)
  from sheet_sources s join artists a on a.id = s.artist_id
  left join t on t.u = s.url left join g on g.u = s.url
  order by a.name, s.title;
$$;
grant execute on function rpc_sheet_sources() to anon, authenticated;
