-- 1. A leaked song with no leak date takes the earliest leak date of its
--    versions (trackers often date "Song [V1]" rather than "Song"). Kept up
--    by a trigger whenever a version gets a leak date.
-- 2. Trackers' "Song [V1]" rows fill the plain song's empty details when the
--    archive has no separate [V1] (never its status).

create or replace function tracks_leak_date_to_main() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if new.parent_track_id is not null and new.leak_date is not null then
    update tracks set leak_date = new.leak_date
    where id = new.parent_track_id and release_status = 'leaked'
      and leak_date is null;
  end if;
  return null;
end $$;

drop trigger if exists tracks_leak_date_to_main on tracks;
create trigger tracks_leak_date_to_main after insert or update of leak_date, parent_track_id on tracks
for each row when (new.parent_track_id is not null and new.leak_date is not null)
execute function tracks_leak_date_to_main();

do $$ begin
  perform sc_begin_batch('fill', 'Leak dates from the song''s earliest leaked version');
  update tracks t set leak_date = v.d
  from (select parent_track_id id, min(leak_date) d from tracks where parent_track_id is not null and leak_date is not null group by 1) v
  where v.id = t.id and t.parent_track_id is null and t.release_status = 'leaked' and t.leak_date is null;
end $$;

do $$
declare d text; o text;
begin
  o := pg_get_functiondef('sc_sheet_reconcile(uuid,text,jsonb)'::regprocedure);
  if position('v_base boolean' in o) > 0 then return; end if; -- already applied
  d := replace(o, E'  v_n int;\r\nbegin', E'  v_n int;\r\n  v_base boolean;\r\nbegin');
  d := replace(d, E'    continue when v_ids is null;\r\n',
E'    v_base := false;\r\n    if v_ids is null and v_key ~ ''\\[v1\\]$'' then\r\n      select array_agg(tk.track_id) into v_ids from track_title_keys tk\r\n      where tk.artist_id = p_home and tk.key = regexp_replace(v_key, ''\\[v1\\]$'', '''') and tk.is_main;\r\n      continue when v_ids is null or cardinality(v_ids) > 1;\r\n      v_base := true;\r\n    end if;\r\n    continue when v_ids is null;\r\n');
  d := replace(d, E'    if v_status not in (''rumored'', ''teased'', ''snippet'', ''leaked'', ''announced'', ''released'') then v_status := null; end if;\r\n',
E'    if v_status not in (''rumored'', ''teased'', ''snippet'', ''leaked'', ''announced'', ''released'') then v_status := null; end if;\r\n    if v_base then v_status := null; end if;\r\n');
  if d = o then raise exception 'patch did not apply'; end if;
  execute d;
end $$;
