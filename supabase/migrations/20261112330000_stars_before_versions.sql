-- The Genius / tracker "unreleased" "*" also sits before a version tag:
-- "Rolls Royce Truck* [V1]", "Brand New* [V2]". Removed when it's the only
-- "*" in the title and comes straight after a letter or number (censored
-- titles like "make sum $* ..." and "*idlm 2*" are left alone), from new
-- songs as they come in and the 178 already here. Title keys ignore it.
create or replace function tracks_aa_strip_star() returns trigger
language plpgsql set search_path to 'public' as $$
begin
  if new.title ~ '\S\s*\*+\s*$' then
    new.title := regexp_replace(new.title, '\s*\*+\s*$', '');
  end if;
  if new.title ~ '[[:alnum:])\]]\*+\s*[\[(]' and length(new.title) - length(replace(new.title, '*', '')) = 1 then
    new.title := regexp_replace(new.title, '([[:alnum:])\]])\*+(\s*[\[(])', '\1\2');
  end if;
  if new.source in ('lastfm', 'local') and new.title ~ '^\s*\d{1,2}\s*\.\s*[[:alpha:]]' and new.title !~ '\s\d{1,2}\.\s'
     and length(regexp_replace(new.title, '^\s*\d{1,2}\s*\.\s*', '')) >= 3 then
    new.title := regexp_replace(new.title, '^\s*\d{1,2}\s*\.\s*', '');
  end if;
  return new;
end $$;

do $$ begin
  perform sc_begin_batch('tidy', 'Titles: * (unreleased marker) before a version removed');
  update tracks set title = regexp_replace(title, '([[:alnum:])\]])\*+(\s*[\[(])', '\1\2')
  where title ~ '[[:alnum:])\]]\*+\s*[\[(]' and length(title) - length(replace(title, '*', '')) = 1;
  perform set_config('static_cuts.batch_id', '', true);
end $$;
