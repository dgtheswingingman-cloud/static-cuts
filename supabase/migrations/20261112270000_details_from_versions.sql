-- A leak or snippet fills its empty details from its own versions:
--   leak date: the earliest leak date of its versions (leaks only)
--   album/era: its leaked/snippet versions' era, when they all agree
--   cover:     its leaked/snippet versions' cover, when they all agree
-- The version triggers already do the first two when a version changes;
-- this also runs when the song itself becomes a leak or snippet (e.g.
-- "status from versions" turning an unconfirmed song leaked), and covers
-- now follow too. Never overwrites anything.
create or replace function sc_fill_main_from_versions(p_id text) returns void
language plpgsql security definer set search_path to 'public' as $$
declare v_cover text; v_fan text; n int;
begin
  update tracks p set leak_date = (select min(v.leak_date) from tracks v where v.parent_track_id = p.id)
  where p.id = p_id and p.release_status = 'leaked' and p.leak_date is null
    and exists (select 1 from tracks v where v.parent_track_id = p.id and v.leak_date is not null);

  update tracks p set album = x.album
  from (select min(v.album) album from tracks v where v.parent_track_id = p_id and v.album is not null
          and v.release_status in ('leaked', 'snippet') having count(distinct v.album) = 1) x
  where p.id = p_id and p.album is null and p.release_status in ('leaked', 'snippet');

  select count(distinct coalesce(v.cover_url, v.fan_cover_url)), min(v.cover_url), min(v.fan_cover_url) into n, v_cover, v_fan
  from tracks v where v.parent_track_id = p_id and coalesce(v.cover_url, v.fan_cover_url) is not null
    and v.release_status in ('leaked', 'snippet');
  if n = 1 then
    update tracks p set cover_url = v_cover, fan_cover_url = case when v_cover is null then v_fan end
    where p.id = p_id and p.cover_url is null and p.fan_cover_url is null and p.release_status in ('leaked', 'snippet');
  end if;
end $$;
revoke execute on function sc_fill_main_from_versions(text) from public, anon, authenticated;

-- The song becomes a leak / snippet.
create or replace function tracks_main_fill_on_status() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  perform sc_fill_main_from_versions(new.id);
  return null;
end $$;
drop trigger if exists tracks_main_fill_on_status on tracks;
create trigger tracks_main_fill_on_status after update of release_status on tracks
for each row when (new.parent_track_id is null and new.release_status in ('leaked', 'snippet')
                   and old.release_status is distinct from new.release_status)
execute function tracks_main_fill_on_status();

-- A version gets a cover.
create or replace function tracks_cover_to_main() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  perform sc_fill_main_from_versions(new.parent_track_id);
  return null;
end $$;
drop trigger if exists tracks_cover_to_main on tracks;
create trigger tracks_cover_to_main after insert or update of cover_url, fan_cover_url, parent_track_id, release_status on tracks
for each row when (new.parent_track_id is not null and coalesce(new.cover_url, new.fan_cover_url) is not null)
execute function tracks_cover_to_main();

-- Everything that can be filled now.
do $$ declare r record; begin
  perform sc_begin_batch('fill', 'Leak dates, eras and covers from the song''s versions');
  for r in select t.id from tracks t where t.parent_track_id is null and t.release_status in ('leaked', 'snippet')
             and ((t.release_status = 'leaked' and t.leak_date is null) or t.album is null or (t.cover_url is null and t.fan_cover_url is null))
             and exists (select 1 from tracks v where v.parent_track_id = t.id) loop
    perform sc_fill_main_from_versions(r.id);
  end loop;
  perform set_config('static_cuts.batch_id', '', true);
end $$;
