-- Approve "same song?" suggestions that are clearly the same song, only ever
-- within one artist (cross-artist suggestions are never touched):
--  * same artist AND same recording (same ISRC, or lengths within 2 seconds)
--  * same artist AND the tag is just a label (Bonus Track, Deluxe, Explicit,
--    Clean, Remastered, Album/Single version...)
--  * "sure" version labels with no main song yet (main song made under the
--    same artist)
-- Runs hourly; each run is one batch in the undo history. Merges need a
-- moderator, so this job gets a narrow pass (static_cuts.system_job).
do $do$
declare d text;
begin
  d := pg_get_functiondef('admin_merge_duplicates'::regproc);
  d := replace(d, 'if not is_moderator() then raise exception ''not authorized''; end if;',
    'if not (is_moderator() or current_setting(''static_cuts.system_job'', true) = ''version-auto-clear'') then raise exception ''not authorized''; end if;');
  if position('system_job' in d) = 0 then raise exception 'patch failed'; end if;
  execute d;
  d := pg_get_functiondef('admin_merge_track'::regproc);
  d := regexp_replace(d, 'if not is_moderator\(\) then(\s+)raise exception ''not authorized'';',
    'if not (is_moderator() or current_setting(''static_cuts.system_job'', true) = ''version-auto-clear'') then\1raise exception ''not authorized'';');
  if position('system_job' in d) = 0 then raise exception 'patch failed'; end if;
  execute d;
end $do$;

create or replace function sc_version_auto_clear()
returns int language plpgsql security definer set search_path to 'public' as $$
declare v_ids uuid[]; n int := 0;
begin
  select array_agg(id) into v_ids from (
    select vs.id
    from version_suggestions vs
    join tracks t on t.id = vs.track_id
    join tracks p on p.id = vs.parent_track_id
    where vs.state = 'open' and vs.cls in ('dupe', 'check') and vs.action in ('merge', 'link')
      and t.artist_id = p.artist_id
      and ((t.isrc is not null and t.isrc = p.isrc)
        or (t.length_sec is not null and p.length_sec is not null and abs(t.length_sec - p.length_sec) <= 2)
        or lower(trim(coalesce(vs.version, ''))) ~ '^(bonus( track)?|deluxe|explicit|clean|album version|original( version| mix)?|single version|remaster(ed)?( \d{4})?|\d{4} remaster(ed)?)$')
    union all
    select vs.id from version_suggestions vs
    where vs.state = 'open' and vs.cls = 'sure' and vs.action = 'create_parent'
  ) x;
  if v_ids is null then return 0; end if;
  perform set_config('static_cuts.system_job', 'version-auto-clear', true);
  perform set_config('static_cuts.batch_id', '', true);
  perform sc_begin_batch('sub_versions', 'Sub-versions: ' || cardinality(v_ids) || ' clear same-song matches (same artist)');
  n := coalesce(sc_apply_version_suggestions(v_ids), 0);
  perform set_config('static_cuts.batch_id', '', true);
  perform set_config('static_cuts.system_job', '', true);
  return n;
end $$;
revoke execute on function sc_version_auto_clear() from public, anon, authenticated;
select cron.schedule('version-auto-clear', '37 * * * *', 'select public.sc_version_auto_clear()');
