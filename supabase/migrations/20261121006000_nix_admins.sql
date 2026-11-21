-- "Run NIX on this PC": admins who switch it on can run it too, not only the owner.
do $$
declare f text; d text;
begin
  foreach f in array array['public.nix_ai_heartbeat(text, boolean, text, jsonb, text)', 'public.nix_ai_claim(text, text)',
                           'public.nix_ai_finish(bigint, text, text, int)'] loop
    d := pg_get_functiondef(f::regprocedure);
    if position('if not is_owner() then raise exception ''owner only''; end if;' in d) = 0 then continue; end if;
    d := replace(d, 'if not is_owner() then raise exception ''owner only''; end if;', 'if not is_admin() then raise exception ''admins only''; end if;');
    execute d;
  end loop;
end $$;
