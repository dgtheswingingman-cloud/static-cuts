-- Sitemap: main songs first, then versions, so search engines reach the
-- main song pages first. (The site now lists 20 parts, up from 10: the 10
-- parts left about 135,000 songs out once the archive passed 400,000.)
create or replace function sc_sitemap_refresh()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_parts int;
begin
  insert into sitemap_parts (part, songs, refreshed_at)
  select p, jsonb_agg(id order by rn), now()
  from (select id, row_number() over (order by (parent_track_id is not null), id) rn,
               ((row_number() over (order by (parent_track_id is not null), id)) - 1) / 40000 as p
        from tracks) x
  group by p
  on conflict (part) do update set songs = excluded.songs, refreshed_at = excluded.refreshed_at;
  select max(part) + 1 into v_parts from sitemap_parts where refreshed_at = now();
  update sitemap_parts set songs = '[]'::jsonb, refreshed_at = now() where part >= coalesce(v_parts, 0);
  return coalesce(v_parts, 0);
end;
$function$;
