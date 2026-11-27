-- Nathan, 27 Nov ("Yes to all"): relabel "Feature on X's song" entries on
-- every artist page (not only the artist-producer pages listed before) when
-- Genius shows the page's artist only produced or wrote the song: "Produced
-- for X." / "A song by X, written by <page>." The page's name has to match
-- a whole credited name (not part of one), and a real feature always wins.
-- First run: about 3,460 produced and 7,250 written, one undo batch. The
-- daily "credit-relabel" task keeps doing it as Genius checks more songs.

create or replace function public.sc_credit_relabel_checked()
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare n int;
begin
  create temp table _relabel on commit drop as
  with c as (
    select t.id, a.name page,
      lower(a.name) = any (select lower(btrim(x)) from regexp_split_to_table(coalesce(t.featured_artists, ''), '\s*(,|&|\band\b)\s*') x) is_feat,
      lower(a.name) = any (select lower(btrim(x)) from regexp_split_to_table(coalesce(t.producers, ''), '\s*(,|&|\band\b)\s*') x) is_prod,
      lower(a.name) = any (select lower(btrim(x)) from regexp_split_to_table(coalesce(t.writers, ''), '\s*(,|&|\band\b)\s*') x) is_wri
    from tracks t join artists a on a.id = t.artist_id
    where t.notes ~ '^Feature on .*''s song\.' and t.credit_role is null and t.genius_checked_at is not null)
  select id, page, case when is_prod then 'producer' else 'writer' end role
  from c where not is_feat and (is_prod or is_wri);
  select count(*) into n from _relabel;
  if n = 0 then return 0; end if;

  perform set_config('static_cuts.batch_id', '', true);
  perform sc_begin_batch('cleanup', '"Feature on" relabelled as produced/written by: ' || n || ' songs');
  update tracks t set
    credit_role = r.role,
    notes = sc_credit_note(r.role, substring(t.notes from '^Feature on (.*)''s song\.'), r.page)
      || coalesce(nullif(regexp_replace(t.notes, '^Feature on .*''s song\.', ''), ''), '')
  from _relabel r where t.id = r.id;
  get diagnostics n = row_count;
  perform set_config('static_cuts.batch_id', '', true);
  return n;
end $function$;

select public.sc_credit_relabel_checked();
