-- Alerts fixes (9 Nov 2026):
--   - weekly timers (e.g. aotw-shortlist, Thursdays) were reported as
--     "stopped running" after 26 hours; now after 8 days
--   - "an import for this artist is already running" and "Last.fm: the artist
--     could not be found" aren't failures and no longer count towards
--     "background job calls failed"
do $$
declare d text := pg_get_functiondef('sc_background_check'::regproc);
begin
  d := replace(d, $q$      when split_part(j.schedule, ' ', 3) <> '*' then interval '32 days'$q$,
                  $q$      when split_part(j.schedule, ' ', 3) <> '*' then interval '32 days'
      when split_part(j.schedule, ' ', 5) <> '*' then interval '8 days'$q$);
  d := replace(d, $q$      and coalesce(result, '') not like '%JWT issued at future%'$q$,
                  $q$      and coalesce(result, '') not like '%JWT issued at future%'
      and coalesce(result, '') not like '%already running%'
      and coalesce(result, '') not like '%could not be found%'$q$);
  if position('interval ''8 days''' in d) = 0 or position('already running' in d) = 0 then raise exception 'patch failed'; end if;
  execute d;
end $$;
