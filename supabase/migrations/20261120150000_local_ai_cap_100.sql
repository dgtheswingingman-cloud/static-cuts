-- Local Cuts "ask Claude" (premium only): 100 asks a day instead of 40
-- (Nathan, 20 Nov). Each ask covers up to 25 files, so ~2,500 files a day.
-- Moderators keep 200; the owner is unlimited.
do $patch$
declare d text;
begin
  d := pg_get_functiondef('public.sc_local_ai_take(uuid, integer)'::regprocedure);
  if position('else 40 end' in d) = 0 then raise exception 'sc_local_ai_take: expected cap not found'; end if;
  execute replace(d, 'else 40 end', 'else 100 end');
end $patch$;
