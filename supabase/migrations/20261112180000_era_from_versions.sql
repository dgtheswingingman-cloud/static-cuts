-- A leak or snippet with no album / era takes its leaked versions' era when
-- they all agree (trackers put the era on "Song [V1]"). Released songs are
-- left alone: their versions are often remixes or live albums.
create or replace function tracks_era_to_main() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if new.parent_track_id is not null and new.album is not null and new.release_status in ('leaked', 'snippet') then
    update tracks p set album = new.album
    where p.id = new.parent_track_id and p.album is null and p.release_status in ('leaked', 'snippet')
      and not exists (select 1 from tracks v where v.parent_track_id = p.id and v.album is not null and v.album <> new.album
                      and v.release_status in ('leaked', 'snippet'));
  end if;
  return null;
end $$;

drop trigger if exists tracks_era_to_main on tracks;
create trigger tracks_era_to_main after insert or update of album, parent_track_id, release_status on tracks
for each row when (new.parent_track_id is not null and new.album is not null)
execute function tracks_era_to_main();

do $$ begin
  perform sc_begin_batch('fill', 'Eras from the song''s leaked versions');
  update tracks t set album = v.album
  from (select parent_track_id id, min(album) album from tracks
        where parent_track_id is not null and album is not null and release_status in ('leaked', 'snippet')
        group by 1 having count(distinct album) = 1) v
  where v.id = t.id and t.parent_track_id is null and t.album is null and t.release_status in ('leaked', 'snippet');
end $$;
