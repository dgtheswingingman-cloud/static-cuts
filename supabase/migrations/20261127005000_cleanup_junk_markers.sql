-- 27 Nov: rows like "Bad habits dupe", "dupe1", "(Duplicate) Exist",
-- "X's & O's* delete", ".mods just delete this thank you" and bare version
-- tags ("[V1]") weren't caught by the clean-up check, which only looked for
-- words like interview / untitled. Now:
--   * a title marked dupe / duplicate / delete (whole words, so "Deletee" is
--     safe) or addressed to mods -> "not_song" (Not songs pile)
--   * a title that is only a version tag ([V1], (V2), [Alt]) -> "placeholder"
-- NIX and Claude are told why it was flagged; nothing is removed without
-- review on /review/cleanup.

create or replace function public.sc_cleanup_kind(p_title text)
returns text language sql immutable parallel safe as $function$
  select case
    when p_title ~* '\m(interview|podcast|livestream|live stream|instagram live|ig live|q ?& ?a|documentary|trailer|behind the scenes|vlog|reaction|unboxing|press conference|radio show)\M'
      or p_title ~* '\m(full (album|tape|ep|mixtape|project|leak)|tracklist|track list|cover art|album art|playlist|snippet compilation|all snippets|snippets compilation)\M'
      or p_title ~* '\m(dupe|duplicate)\M|\mdupe\d+$|\mdelete( this| me)?\M|\mmods?\M.*\mdelete'
      then 'not_song'
    when p_title ~* '^\s*(unknown|untitled|\?+|tba|tbd|n/?a|none|null|-+)\s*(song|track)?s?\s*[#\d\s]*$'
      or p_title ~* '^\s*(two |three |\d+ )?unknown songs?\M'
      or p_title !~ '[[:alnum:]]'
      or p_title ~* '^\s*[\[\(]\s*(v\s*\d+|alt(ernate)?|og|demo|\?+)\s*[\]\)]\s*$'
      then 'placeholder'
  end
$function$;

do $$
declare d text := pg_get_functiondef('public.sc_nix_review_items(text, integer)'::regprocedure);
begin
  d := replace(d, $p$case sc_cleanup_kind(t.title) when 'not_song' then 'not a song' else 'placeholder' end$p$,
                  $p$case when t.title ~* '\m(dupe|duplicate)\M|\mdupe\d+$|\mdelete( this| me)?\M|\mmods?\M.*\mdelete'
                           then 'marked by whoever added it as a duplicate or to delete'
                         when t.title ~* '^\s*[\[\(]\s*(v\s*\d+|alt(ernate)?|og|demo|\?+)\s*[\]\)]\s*$'
                           then 'placeholder (the title is only a version tag)'
                         when sc_cleanup_kind(t.title) = 'not_song' then 'not a song' else 'placeholder' end$p$);
  if position('marked by whoever added it' in d) = 0 then raise exception 'patch missed: review_items'; end if;
  execute d;
end $$;

do $$
declare d text := pg_get_functiondef('public.sc_nix_review_prompt(text, jsonb)'::regprocedure);
begin
  d := replace(d, $p$"unsure": can''t tell.';
    opts := 'not_song|placeholder|real_song|unsure';$p$,
$p$An entry whose title marks it as a duplicate ("dupe", "(Duplicate)") or asks for it to be deleted is "not_song" (it should go), even if a real song title is in it: the real song is filed elsewhere.
"unsure": can''t tell.';
    opts := 'not_song|placeholder|real_song|unsure';$p$);
  if position('marks it as a duplicate' in d) = 0 then raise exception 'patch missed: review_prompt'; end if;
  execute d;
end $$;
