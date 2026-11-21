-- Without Ollama's strict JSON mode the PC's model sometimes writes slightly
-- broken JSON (a stray quote, a missing bracket, quotes inside a reason), and
-- one bad bit lost the whole batch. Now each answer is read on its own
-- (sc_nix_parse), only real choices are kept (sc_nix_valid_verdict; anything
-- else is tried again later), and prompts show one example answer instead of
-- the list of options (which small models sometimes copied back).

lock table public.nix_ai_jobs, public.nix_work, public.nix_notes, public.nix_suggestions in access exclusive mode;

create or replace function public.sc_nix_parse(p text)
returns jsonb language plpgsql immutable as $$
declare j jsonb; seg text; outv jsonb := '[]'; m text[]; parts text[]; i int; o jsonb; f text; rest text; e int;
begin
  begin
    j := substring(p from '\{.*\}')::jsonb;
    if jsonb_typeof(j -> 'r') = 'array' then return j -> 'r'; end if;
  exception when others then null;
  end;
  parts := regexp_split_to_array(coalesce(p, ''), '"n"\s*:\s*');
  for i in 2..coalesce(array_length(parts, 1), 0) loop
    seg := parts[i];
    m := regexp_match(seg, '^(\d+)');
    continue when m is null;
    o := jsonb_build_object('n', m[1]::int);
    foreach f in array array['v', 'sure', 'era', 'title', 'producers', 'featuring', 'other_names', 'leak_date', 'why'] loop
      rest := substring(seg from '"' || f || '"\s*:\s*"(.*)$');
      continue when rest is null;
      e := regexp_instr(rest, '"\s*(,\s*"?[a-z_]+"\s*:|\}|\]|$)');
      if e > 0 then o := o || jsonb_build_object(f, left(rest, e - 1)); end if;
    end loop;
    outv := outv || jsonb_build_array(o);
  end loop;
  return outv;
end $$;

create or replace function public.sc_nix_valid_verdict(p_kind text, v text)
returns boolean language sql immutable as $$
  select lower(coalesce(v, '')) = any (case p_kind
    when 'duplicates' then array['same', 'different', 'unsure']
    when 'cleanup' then array['not_song', 'placeholder', 'real_song', 'unsure']
    when 'mixups' then array['mixup', 'fine', 'unsure']
    when 'deezer' then array['same', 'different', 'mixed', 'unsure']
    when 'audit' then array['yes', 'no', 'unsure']
    else null end);
$$;

do $$
declare d text;
begin
  -- review notes: tolerant reading, real choices only
  d := pg_get_functiondef('public.sc_nix_review'::regproc);
  d := replace(d, '    begin ans := substring(j.output from ''\{.*\}'')::jsonb; exception when others then continue; end;
', '');
  d := replace(d, 'for r in select value from jsonb_array_elements(coalesce(ans -> ''r'', ''[]'')) loop',
                  'for r in select value from jsonb_array_elements(sc_nix_parse(j.output)) loop
      continue when not coalesce(sc_nix_valid_verdict(substring(j.kind from 8), r ->> ''v''), false);');
  if position('sc_nix_parse(j.output)' in d) = 0 or position('substring(j.output from' in d) > 0 then raise exception 'review patch missed'; end if;
  execute d;

  -- suggestions: tolerant reading; the audit needs a real yes/no/unsure
  d := pg_get_functiondef('public.sc_nix_suggest'::regproc);
  d := replace(d, '      begin ans := substring(j.output from ''\{.*\}'')::jsonb; exception when others then ans := null; end;
', '');
  d := replace(d, 'for r in select value from jsonb_array_elements(coalesce(ans -> ''r'', ''[]'')) loop',
                  'for r in select value from jsonb_array_elements(sc_nix_parse(j.output)) loop');
  d := replace(d, '        continue when k is null;
        made := made',
                  '        continue when k is null;
        continue when v_kind = ''audit'' and not coalesce(sc_nix_valid_verdict(''audit'', r ->> ''v''), false);
        made := made');
  if position('sc_nix_parse(j.output)' in d) = 0 or position('sc_nix_valid_verdict(''audit''' in d) = 0 then raise exception 'suggest patch missed'; end if;
  execute d;

  -- prompts: one example answer, the choices spelled out
  d := pg_get_functiondef('public.sc_nix_review_prompt(text, jsonb)'::regprocedure);
  d := replace(d, '{"r":[{"n":1,"v":"'' || opts || ''","why":"under 15 words"}, ...]} covering every number.''',
                  '{"r":[{"n":1,"v":"'' || split_part(opts, ''|'', 1) || ''","why":"under 15 words"}, ...]} covering every number. "v" must be exactly one word from: '' || replace(opts, ''|'', '', '') || ''.''');
  if position('split_part(opts' in d) = 0 then raise exception 'prompt patch missed'; end if;
  execute d;

  d := pg_get_functiondef('public.sc_nix_suggest_batch'::regproc);
  d := replace(d, '"sure":"high|medium|low"', '"sure":"medium"');
  d := replace(d, '{"n":1,"v":"yes|no|unsure","why":"a few words","sure":"medium"}', '{"n":1,"v":"yes","why":"a few words","sure":"medium"}');
  d := replace(d, 'covering every number.'';', 'covering every number. "sure" is how sure you are: high, medium or low.'';');
  d := replace(d, '"unsure": can''''t tell.'';
    v_prompt := head', '"unsure": can''''t tell.
"v" must be exactly one of: yes, no, unsure.'';
    v_prompt := head');
  if position('"sure":"high|medium|low"' in d) > 0 or position('high, medium or low' in d) = 0 then raise exception 'batch patch missed'; end if;
  execute d;
end $$;
