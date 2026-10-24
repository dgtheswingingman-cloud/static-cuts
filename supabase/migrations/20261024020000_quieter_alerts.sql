-- Admin alerts: "background job calls failed" only when a job call failed 3
-- or more times in the hour. A single timeout is harmless (the next run
-- carries on) and was showing up every few hours on the small database.
do $$
declare
  d text := pg_get_functiondef('public.sc_background_check()'::regprocedure);
begin
  if position('if v_failed > 0 then' in d) > 0 then
    execute replace(d, 'if v_failed > 0 then', 'if v_failed >= 3 then  -- 1 or 2 one-off failures: no alert');
  end if;
end $$;
