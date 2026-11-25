-- 25 Nov: Claude's quick "agree" on version audit and eras was often wrong in
-- a sample (it agreed to unlink demos, live recordings and an "Original
-- Version"; it accepted eras picked from a year alone, and a released song's
-- music video filed under the wrong album). Those two kinds now get a careful
-- check (medium effort, 15 at a time), stricter rules, and every open "agree"
-- in them is checked again.

do $$
declare d text := pg_get_functiondef('public.sc_nix_check_batch(text, integer)'::regprocedure);
begin
  d := replace(d, $p$v_n := case when v_kind in ('eras', 'notes', 'status') then least(p_limit, 20)$p$,
                  $p$v_n := case when v_kind in ('eras', 'audit') then least(p_limit, 15) when v_kind in ('notes', 'status') then least(p_limit, 20)$p$);
  d := replace(d, $p$think := v_kind in ('eras', 'notes', 'status', 'mixups', 'deezer');$p$,
                  $p$think := v_kind in ('eras', 'audit', 'notes', 'status', 'mixups', 'deezer');$p$);
  d := replace(d, $p$'kind', v_kind, 'think', think,$p$,
                  $p$'kind', v_kind, 'think', think, 'effort', case when v_kind in ('eras', 'audit') then 'medium' else 'low' end,$p$);
  if position($p$when v_kind in ('eras', 'audit') then least(p_limit, 15)$p$ in d) = 0
     or position($p$('eras', 'audit', 'notes'$p$ in d) = 0
     or position($p$'effort', case$p$ in d) = 0 then raise exception 'patch missed: check_batch'; end if;
  execute d;
end $$;

do $$
declare d text := pg_get_functiondef('public.sc_nix_check_rules(text)'::regprocedure);
begin
  d := replace(d, $p$When you disagree the right answer is "keep linked".'$p$,
$p$When you disagree the right answer is "keep linked".
Be strict here. These are NOT reasons to unlink, so disagree when they are NIX''s only reason: a version tag (Demo, Live, Live Album, Original Version, Remix, Session, Music Video, Acoustic, Instrumental, Snippet, [V1], [V2]), a year or place in brackets, an album or songbook name in brackets, or "a cover" of the same song. The same composition sung by someone else on this page is still a version. Only agree when the two titles are really different songs.'$p$);
  d := replace(d, $p$Say unsure when other eras share the year and nothing else decides it.'$p$,
$p$Say unsure when other eras share the year and nothing else decides it.
Be strict here: a wrong agree is much worse than an unsure. A date alone is enough ONLY when the bracket says no other era has songs from that year ("none"). A word in the title that happens to match the era name is not enough unless it really names that project. A released song, its music video, a live recording or an acoustic version belongs to the album or single it came out on: agree only when that is the era NIX gave, and disagree with that album as the answer when you know it. If you are not sure, say unsure.'$p$);
  if position('a wrong agree is much worse' in d) = 0 or position('These are NOT reasons to unlink' in d) = 0 then raise exception 'patch missed: rules'; end if;
  execute d;
end $$;

-- Check every open "agree" in these two piles again.
update public.nix_suggestions
set check_verdict = null, check_answer = null, check_note = null, checked_at = null, check_claim_at = null
where kind in ('audit', 'eras') and state = 'open' and check_verdict = 'agree' and final_side is null;
