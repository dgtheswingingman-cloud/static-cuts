-- The name everywhere, including the hidden marker on bios written here:
-- 'Static Cuts' -> 'Static-Cuts'.
do $d$
declare r record; src text; n text;
begin
  for r in select p.oid from pg_proc p join pg_namespace s on s.oid = p.pronamespace
           where s.nspname = 'public' and p.proname in ('sc_wiki_next', 'sc_wiki_save', 'admin_set_artist_about') loop
    src := pg_get_functiondef(r.oid);
    n := replace(src, '''Static Cuts''', '''Static-Cuts''');
    if n <> src then execute n; end if;
  end loop;
end $d$;
update public.artists set bio_source = 'Static-Cuts' where bio_source = 'Static Cuts';
