-- Nathan, 25 Nov ("Yea"): apply agreed NIX answers automatically so he only
-- reviews disagreements. Only cleaned titles and producers taken out of titles
-- qualify (24/25 right in a sample). Not featured artists (a remixer got
-- listed as a feature), and not eras or version audit: Claude's "agrees" there
-- were often wrong in a sample (demos and live versions it agreed to unlink,
-- eras picked from a year alone). Every day at 05:29, one undo batch.

do $$
declare d text := pg_get_functiondef('public.admin_nix_suggestions_decide(bigint[], boolean)'::regprocedure);
begin
  d := replace(d, $p$if not is_moderator() then raise exception 'not authorized'; end if;$p$,
    $p$if not (is_moderator() or current_setting('static_cuts.system_job', true) = 'nix-auto-accept') then raise exception 'not authorized'; end if;$p$);
  if position('nix-auto-accept' in d) = 0 then raise exception 'patch missed: decide'; end if;
  execute d;
end $$;

create or replace function public.sc_apply_agreed_titles() returns int
language plpgsql security definer set search_path = public as $$
declare ids bigint[]; n int;
begin
  select array_agg(id order by id) into ids from nix_suggestions
  where kind = 'titles' and state = 'open' and field in ('title', 'producers')
    and check_verdict = 'agree' and coalesce(final_side, 'nix') = 'nix';
  if ids is null then return 0; end if;
  perform set_config('static_cuts.system_job', 'nix-auto-accept', true);
  n := admin_nix_suggestions_decide(ids, true);
  perform set_config('static_cuts.system_job', '', true);
  perform set_config('static_cuts.batch_id', '', true);
  return n;
end $$;
revoke all on function public.sc_apply_agreed_titles() from public, anon, authenticated;

insert into public.nix_tasks (name, every, max_every, at_time, next_at, enabled, steps)
values ('agreed-titles', '1 day', '1 day', '05:29:00', (current_date + 1) + time '05:29', true,
        '[{"name":"applied","sql":"public.sc_apply_agreed_titles()"}]')
on conflict (name) do update set steps = excluded.steps, at_time = excluded.at_time, enabled = true;
