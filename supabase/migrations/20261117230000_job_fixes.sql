-- Applied live 17 Nov 2026; recorded here.
-- 1) duplicate-refresh failed hourly from 15 Nov: one group's id (its track ids
--    joined with commas) passed the 2,704-byte index limit. Long ids (>1,000
--    chars) become 'h:' + md5; shorter ids, and so all dismissals, unchanged.
create or replace function public.sc_group_id(p_track_ids text[])
returns text language sql immutable set search_path to 'public' as $function$
  select case when length(j) > 1000 then 'h:' || md5(j) else j end
  from (select string_agg(x, ',' order by x) j from unnest(p_track_ids) x) s
$function$;
-- 2) sc_mb_save failed ~688 times a day for bands whose members had more than
--    one stint (same person listed twice -> "ON CONFLICT ... cannot affect row
--    a second time"). Patched live to merge stints (all roles, earliest start,
--    latest end) with "group by l ->> 'mbid', l ->> 'kind'" before the upsert.
