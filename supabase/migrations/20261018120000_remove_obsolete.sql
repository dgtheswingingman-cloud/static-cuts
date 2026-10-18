-- Removing things that newer features replaced.
--
-- 1. tracks.track_type ("studio" / "alternate_version"): every song said
--    "studio"; whether a song is a version is now whether it sits under a
--    main song (parent_track_id). The three functions that still filled it
--    in stop doing so, then the column goes.
-- 2. tracks.possible_links_attempted_at: only used by the Brave web-search
--    link finder, which is retired (ChatGPT's "find links" and the Genius
--    import cover it). Links it already suggested stay.

do $$
declare
  f record;
  d text;
begin
  for f in
    select p.oid from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prosrc ilike '%track_type%'
  loop
    d := pg_get_functiondef(f.oid);
    -- column lists
    d := replace(d, ' spotify_url, track_type, is_featured', ' spotify_url, is_featured');
    -- approve_submission values
    d := regexp_replace(d, '[ \t]*coalesce\(sub\.payload->>''track_type'', ''[a-z_]+''\),\r?\n', '', 'g');
    -- admin_add_track value
    d := regexp_replace(d, '[ \t]*case when p_parent_track_id is not null and p_parent_track_id <> '''' then ''alternate_version'' else ''studio'' end,\r?\n', '', 'g');
    -- promote_discovery payload keys
    d := regexp_replace(d, '[ \t]*''track_type'', ''[a-z_]+'',\r?\n', '', 'g');
    if d ilike '%track_type%' then
      raise exception 'Could not remove track_type from %', f.oid::regprocedure;
    end if;
    execute d;
  end loop;
end $$;

alter table tracks drop column if exists track_type;
alter table tracks drop column if exists possible_links_attempted_at;

select count(*) as functions_still_using_track_type
from pg_proc where pronamespace = 'public'::regnamespace and prosrc ilike '%track_type%';
