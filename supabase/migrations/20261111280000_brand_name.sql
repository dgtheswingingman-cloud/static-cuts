-- The name everywhere people see it: "Static-Cuts" / "STATIC-CUTS//" (with
-- the hyphen), not "Static Cuts". Applied to the functions whose text shows
-- (announcement replies, the ChatGPT research plan, post captions, Discord
-- replies) and the posts not posted yet. The internal bio_source marker
-- 'Static Cuts' (bios written here) is left as it is: it never shows.
do $d$
declare r record; src text; n text;
begin
  for r in select p.oid from pg_proc p join pg_namespace s on s.oid = p.pronamespace
           where s.nspname = 'public' and p.proname in ('rpc_submit_announcement', 'rpc_research_plan', 'sc_social_build', 'sc_discord_sub') loop
    src := pg_get_functiondef(r.oid);
    n := replace(replace(replace(replace(src, 'STATIC CUTS // ', 'STATIC-CUTS// '), 'Static Cuts', 'Static-Cuts'), 'static cuts', 'static-cuts'), 'STATIC CUTS', 'STATIC-CUTS');
    if n <> src then execute n; end if;
  end loop;
end $d$;
update public.social_posts set captions = replace(replace(replace(replace(captions::text, 'STATIC CUTS // ', 'STATIC-CUTS// '), 'Static Cuts', 'Static-Cuts'), 'static cuts', 'static-cuts'), 'STATIC CUTS', 'STATIC-CUTS')::jsonb
where posted = '{}' and captions::text ilike '%static cuts%';
