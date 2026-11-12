-- Titles that start with a track number from someone's files ("2.safehouse
-- (prod.whitearmor&yung sherman)", "02. Teddy Picker"), mostly from Last.fm.
-- 1. New songs: the leading "2." / "02. " is stripped as they come in (only
--    before a letter: "7-Eleven", "1.5 Million" are untouched).
-- 2. Ones already here: merged into the real song when the archive has it
--    (status, dates, track numbers carry over), otherwise renamed. Titles
--    listing several numbers ("1. X, 2. Y") are left alone.
create or replace function tracks_aa_strip_star() returns trigger
language plpgsql set search_path to 'public' as $$
begin
  if new.title ~ '\S\s*\*+\s*$' then
    new.title := regexp_replace(new.title, '\s*\*+\s*$', '');
  end if;
  if new.title ~ '^\s*\d{1,2}\s*\.\s*[[:alpha:]]' and new.title !~ '\s\d{1,2}\.\s' then
    new.title := regexp_replace(new.title, '^\s*\d{1,2}\s*\.\s*', '');
  end if;
  return new;
end $$;

do $$
declare r record;
begin
  create temp table _n on commit drop as
  select t.id, t.artist_id, t.title,
    btrim(regexp_replace(regexp_replace(t.title, '^\s*\d{1,2}\s*\.\s*', ''), '\s*[([]\s*prod\b[^)\]]*[)\]]', '', 'gi')) clean
  from tracks t where t.parent_track_id is null and t.title ~ '^\s*\d{1,2}\s*\.\s*[[:alpha:]]' and t.title !~ '\s\d{1,2}\.\s';
  create temp table _p on commit drop as
  select n.id copy_id, n.clean, (select k.track_id from track_title_keys k join tracks o on o.id = k.track_id
     where k.artist_id = n.artist_id and k.key = sc_title_key(n.clean) and k.track_id <> n.id and o.title !~ '^\s*\d{1,2}\s*\.'
     order by k.is_main desc, o.created_at nulls first limit 1) orig_id
  from _n n;
  perform set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'dg.theswingingman@gmail.com'), 'role', 'authenticated')::text, true);
  perform sc_begin_batch('merge', 'Numbered titles: copies merged into the real song');
  for r in select * from _p where orig_id is not null loop
    perform admin_merge_duplicates(r.orig_id, array[r.copy_id]);
  end loop;
  perform set_config('static_cuts.batch_id', '', true);
  perform sc_begin_batch('tidy', 'Numbered titles: track number removed');
  update tracks t set title = p.clean from _p p where p.orig_id is null and t.id = p.copy_id and p.clean <> '';
  perform set_config('static_cuts.batch_id', '', true);
end $$;
