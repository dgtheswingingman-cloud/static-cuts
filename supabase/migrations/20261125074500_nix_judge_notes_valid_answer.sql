-- 25 Nov: one final-say answer on a found link came back as a sentence
-- instead of one of the allowed words, and showed up as its own pile. A
-- review note's right answer must now be one of the words NIX could pick;
-- anything else counts as "unsure".

do $$
declare d text := pg_get_functiondef('public.sc_nix_judge_save'::regproc);
begin
  d := replace(d, '      ik := substring(k from length(kd) + 4);
      update nix_notes set final_side = side,',
'      ik := substring(k from length(kd) + 4);
      -- a review note''s right answer must be one of the words NIX could pick
      if side in (''checker'', ''neither'') and not coalesce(sc_nix_valid_verdict(kd, lower(ans)), false) then side := ''unsure''; ans := null; end if;
      ans := lower(ans);
      update nix_notes set final_side = side,');
  if position('must be one of the words NIX could pick' in d) = 0 then raise exception 'patch missed'; end if;
  execute d;
end $$;
update public.nix_notes set final_side = 'unsure', final_answer = null
where judged_at is not null and final_side in ('checker', 'neither') and not coalesce(sc_nix_valid_verdict(kind, lower(final_answer)), false);
