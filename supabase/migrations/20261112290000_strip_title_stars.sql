-- A trailing "*" (or "**") on a song title is Genius's / trackers' marker for
-- "unreleased", not part of the name: "Coupe*" is "Coupe". Strip it from new
-- songs as they come in and from the ones already here. The title key already
-- ignores it, so matching and search don't change.
create or replace function tracks_aa_strip_star() returns trigger
language plpgsql set search_path to 'public' as $$
begin
  if new.title ~ '\S\s*\*+\s*$' then
    new.title := regexp_replace(new.title, '\s*\*+\s*$', '');
  end if;
  return new;
end $$;
drop trigger if exists tracks_aa_strip_star on tracks;
create trigger tracks_aa_strip_star before insert on tracks
for each row execute function tracks_aa_strip_star();

do $$ begin
  perform sc_begin_batch('tidy', 'Titles: trailing * (unreleased marker) removed');
  update tracks set title = regexp_replace(title, '\s*\*+\s*$', '') where title ~ '\S\s*\*+\s*$';
  perform set_config('static_cuts.batch_id', '', true);
end $$;
