-- Artist suggestions from Spotify imports:
--   1. aren't counted by the "60 suggestions an hour" anti-spam limit (they
--      come from the import, which has its own limits, not typed by hand)
--   2. no 25-per-import cap (the earlier fix for this never went in)
-- Then suggests the rest of the artists already saved from imports.
do $$
declare
  d text := pg_get_functiondef('public.submissions_anti_spam()'::regprocedure);
begin
  if position('from_spotify' in d) = 0 then
    d := replace(d, 'if v_uid is null or is_moderator() then return new; end if;',
                    'if v_uid is null or is_moderator() or coalesce(new.payload ->> ''from_spotify'', '''') = ''true'' then return new; end if;');
    if position('from_spotify' in d) = 0 then raise exception 'could not update submissions_anti_spam'; end if;
    execute d;
  end if;
end $$;

do $$
declare
  d text := pg_get_functiondef('public.rpc_suggest_library_artists(jsonb)'::regprocedure);
begin
  d := replace(d, E'    limit 25\n', E'\n');
  d := replace(d, E'    limit 25\r\n', E'\r\n');
  execute d;
  if position('limit 25' in pg_get_functiondef('public.rpc_suggest_library_artists(jsonb)'::regprocedure)) > 0 then
    raise exception 'could not remove the cap';
  end if;
end $$;

-- Suggest everything already saved (as the owner, who ran the imports).
select set_config('request.jwt.claims',
  json_build_object('sub', (select id from auth.users where email = 'dg.theswingingman@gmail.com'), 'role', 'authenticated')::text, true);
select rpc_suggest_library_artists('[]'::jsonb) as newly_suggested;
