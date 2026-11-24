-- Nathan, 24 Nov ("do what you gotta do"), after a few days of Claude checking
-- everything NIX did:
-- 1. Version audit: Claude disagreed with 8,502 of its 8,887 unlink
--    suggestions (remasters, V-numbers, live takes...). Those are dismissed
--    (no songs change); the ones Claude agreed with or wasn't sure about stay.
-- 2. Eras: Claude could only back about 1 in 7 (most it couldn't tell, many
--    wrong), so NIX stops making new era suggestions (setting
--    nix_suggest_kinds; open ones stay on /review/nix). "From notes" carries
--    on: about half are right, and Claude's check sorts those out reliably,
--    and the review jobs (duplicates, clean-up) have run out of new work, so
--    the laptop would otherwise sit idle.

update public.nix_suggestions
set state = 'rejected', decided_at = now()  -- decided_by left empty: a bulk tidy, not one-by-one decisions
where kind = 'audit' and state = 'open' and check_verdict = 'disagree';

insert into public.sc_private_settings (key, value) values ('nix_suggest_kinds', 'titles,audit,notes')
on conflict (key) do update set value = excluded.value;

do $$
declare d text := pg_get_functiondef('public.sc_nix_suggest'::regproc);
begin
  d := replace(d, 'foreach v_kind in array array[''titles'', ''audit'', ''notes'', ''eras''] loop',
    'foreach v_kind in array string_to_array(coalesce((select value from sc_private_settings where key = ''nix_suggest_kinds''), ''titles,audit,notes,eras''), '','') loop');
  if position('nix_suggest_kinds' in d) = 0 then raise exception 'patch missed'; end if;
  execute d;
end $$;
