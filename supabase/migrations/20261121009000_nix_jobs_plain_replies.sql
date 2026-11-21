-- Ollama's strict JSON mode can make small models write endless blank space
-- (a known Ollama problem), so review and suggestion batches ask for JSON in
-- the prompt instead; the answer is read the same way.
update public.nix_ai_jobs set json_reply = false where status = 'queued' and (kind like 'review:%' or kind like 'suggest:%');

do $$
declare d text;
begin
  d := pg_get_functiondef('public.sc_nix_review'::regproc);
  if position('jsonb_build_object(''keys'', (select jsonb_agg(x -> ''key'') from jsonb_array_elements(items) x)), true);' in d) = 0 then raise exception 'anchor 1 missing'; end if;
  execute replace(d, 'jsonb_build_object(''keys'', (select jsonb_agg(x -> ''key'') from jsonb_array_elements(items) x)), true);',
                     'jsonb_build_object(''keys'', (select jsonb_agg(x -> ''key'') from jsonb_array_elements(items) x)), false);');
  d := pg_get_functiondef('public.sc_nix_suggest'::regproc);
  if position('jsonb_build_object(''keys'', b -> ''keys'', ''group'', b -> ''group''), true);' in d) = 0 then raise exception 'anchor 2 missing'; end if;
  execute replace(d, 'jsonb_build_object(''keys'', b -> ''keys'', ''group'', b -> ''group''), true);',
                     'jsonb_build_object(''keys'', b -> ''keys'', ''group'', b -> ''group''), false);');
end $$;
