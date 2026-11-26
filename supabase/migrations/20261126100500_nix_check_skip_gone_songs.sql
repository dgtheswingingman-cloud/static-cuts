-- A suggestion whose song was deleted (merged, removed) has no check line, and
-- when it was the oldest one waiting, the check batch came back empty and
-- Claude's checking stopped (26 Nov, ~09:40). Mark those stale, and have the
-- batch do it too.
update public.nix_suggestions s set state = 'stale', decided_at = now(), check_claim_at = null
where s.state = 'open' and not exists (select 1 from public.tracks t where t.id = s.track_id);

do $$
declare d text := pg_get_functiondef('public.sc_nix_check_batch(text, integer)'::regprocedure);
begin
  d := replace(d, $p$  select kind into v_kind from nix_suggestions
  where state = 'open' and checked_at is null$p$,
$p$  update nix_suggestions s set state = 'stale', decided_at = now(), check_claim_at = null
  where s.state = 'open' and s.checked_at is null and not exists (select 1 from tracks t where t.id = s.track_id);

  select kind into v_kind from nix_suggestions
  where state = 'open' and checked_at is null$p$);
  if position($p$set state = 'stale', decided_at = now(), check_claim_at = null$p$ in d) = 0 then raise exception 'patch missed: check_batch'; end if;
  execute d;
end $$;
