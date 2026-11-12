-- A release date is when a song came out officially; a leak date is when its
-- file surfaced. Leaks / snippets / rumoured / teased songs can't be sent a
-- release date (rpc_suggest_details refuses it with a note), and leaks and
-- snippets whose only date was stored as a release date get it as their leak
-- date (that's when they surfaced). Released songs keep any leak date as
-- history. The song page only shows a release date for released, removed and
-- announced songs.
do $$
declare d text; o text;
begin
  o := pg_get_functiondef('rpc_suggest_details(jsonb)'::regprocedure);
  if position('so it has no release date' in o) = 0 then
    d := replace(o, $x$  if (p ->> 'release_date') ~ '^\d{4}-\d{2}-\d{2}$' then
    begin$x$, $x$  if (p ->> 'release_date') ~ '^\d{4}-\d{2}-\d{2}$' and t.release_status in ('leaked', 'snippet', 'rumored', 'teased') then
    raise exception '"%" is %, not released, so it has no release date (that is only for songs that came out officially). For a leak or snippet send leak_date, the day the file surfaced. If it really did come out officially, send that with submit_discovery first.', t.title, t.release_status;
  end if;
  if (p ->> 'release_date') ~ '^\d{4}-\d{2}-\d{2}$' then
    begin$x$);
    if d = o then raise exception 'patch did not apply'; end if;
    execute d;
  end if;
end $$;

do $$ begin
  perform sc_begin_batch('fill', 'Leaks and snippets: their only date was stored as a release date, now their leak date');
  update tracks set leak_date = release_date
  where release_status in ('leaked', 'snippet') and leak_date is null and release_date is not null and release_date <= current_date;
end $$;
