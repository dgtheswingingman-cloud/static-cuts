-- 25 Nov: a sample of "from notes" suggestions Claude had agreed with showed
-- OG filenames accepted as other names ("KW - Thank You Instrumental"), a
-- reference-track singer as producer and reference vocals as features.
-- Claude's check for "from notes" now spells those out (the final say and
-- NIX's own prompt already did), and the open ones it agreed with are
-- checked again before any are applied.

do $$
declare d text := pg_get_functiondef('public.sc_nix_check_rules'::regproc);
begin
  d := replace(d, 'Disagree when it is guessed, about another song, the wrong field, or badly formatted; the right answer is the correct value, or "nothing".',
    'Disagree when it is guessed, about another song, the wrong field, or badly formatted; the right answer is the correct value, or "nothing". An "OG Filename" or file name is NOT another name (other names are real titles the song is known by). Engineers, mixers, sample sources and people who did a reference track are not producers. Reference vocals, open verses and people "seen in the studio" are not features, and the song''''s own main artist is never a feature.');
  if position('OG Filename" or file name is NOT another name (other names' in d) = 0 then raise exception 'patch missed'; end if;
  execute d;
end $$;

update public.nix_suggestions set check_verdict = null, check_answer = null, check_note = null, checked_at = null, check_claim_at = null
where kind = 'notes' and state = 'open' and check_verdict = 'agree';
