-- Claude's sub-version job: "same song" merges are admin-only, so Claude's
-- yes on a merge is only noted (the owner approves it on /review/versions).
-- Applying it from the job failed with "not authorized" and blocked the
-- whole batch every 10 minutes.
do $do$
declare d text := pg_get_functiondef('sc_version_ai_save(text,jsonb)'::regprocedure);
declare a text := 'array_agg(vs.id) filter (where vs.ai_verdict = ''yes'')';
begin
  if position('vs.action <> ''merge''' in d) = 0 then
    if position(a in d) = 0 then raise exception 'anchor not found'; end if;
    d := replace(d, a, 'array_agg(vs.id) filter (where vs.ai_verdict = ''yes'' and vs.action <> ''merge'')');
    execute d;
  end if;
end;
$do$;
