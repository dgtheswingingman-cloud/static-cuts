-- 24 Nov: from 02:51 every nix-suggest run failed ("null value in column
-- prompt"): an eras item (an artist whose eras list came back empty) made a
-- batch with no prompt, and that one failure stopped the whole run, so no
-- new suggestions were queued for the PC for ~20 hours. Items that can't make
-- a prompt now leave NIX's to-do list (the daily seed puts them back if they
-- become answerable), and the rest carry on.

do $$
declare d text := pg_get_functiondef('public.sc_nix_suggest'::regproc);
begin
  d := replace(d, '      continue when b is null;
', '      continue when b is null;
      if b ->> ''prompt'' is null then
        delete from nix_work w where w.kind = v_kind and w.item_key in (select jsonb_array_elements_text(b -> ''keys''));
        continue;
      end if;
');
  if position('if b ->> ''prompt'' is null' in d) = 0 then raise exception 'patch missed'; end if;
  execute d;
end $$;
