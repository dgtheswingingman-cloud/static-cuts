-- Nathan, 20 Nov: relabel "Feature on X's song" on 37 producer / label /
-- songwriter pages as what they actually did. Undo batch; songs stay put.
insert into public.artist_credit_roles (artist_id, role)
select a.id, x.role from (values
 ('Cashmoneyap','producer'),('Charlie Heat','producer'),('Brentrambo','producer'),('Mikey The Magician','producer'),('Dolan Beats','producer'),
 ('Ryder Johnson','producer'),('TrapMoneyBenny','producer'),('Plu2o Nash','producer'),('RONNY J','producer'),('Digital Nas','producer'),
 ('88-Keys','producer'),('Woesum','producer'),('triplesixdelete','producer'),('DJ Khalil','producer'),('Mike WiLL Made-It','producer'),
 ('Boy Wonder Cf','producer'),('Powers Pleasant','producer'),('Alice Gas','producer'),('BNYX®','producer'),('Alexander Lewis','producer'),
 ('Metro Boomin','producer'),('Mustard','producer'),('Jermaine Dupri','producer'),('CMTEN','producer'),('Lofty305','producer'),
 ('prodby668','producer'),('Skread','producer'),('boolymon','producer'),('Working On Dying','producer'),('Pi’erre Bourne','producer'),
 ('DJ Scheme','producer'),
 ('Quality Control','label'),('Internet Money','label'),('Lyrical Lemonade','label'),
 ('Cole Porter','writer'),('Kurt Cobain','writer'),('Natalia Kills','writer')
) x(name, role) join public.artists a on a.name = x.name
on conflict (artist_id) do update set role = excluded.role;

do $$ declare n int;
begin
  perform set_config('static_cuts.batch_id', '', true);
  perform sc_begin_batch('cleanup', 'Producers, labels and songwriters: "Feature on" relabelled on 37 pages');
  update tracks t set
    credit_role = r.role,
    notes = sc_credit_note(r.role, substring(t.notes from '^Feature on (.*)''s song\.'), a.name)
      || coalesce(nullif(regexp_replace(t.notes, '^Feature on .*''s song\.', ''), ''), ''),
    producers = case when r.role = 'producer' and position(lower(a.name) in lower(coalesce(t.producers, ''))) = 0
                     then nullif(trim(both ', ' from coalesce(t.producers, '') || ', ' || a.name), '')
                     else t.producers end
  from artist_credit_roles r join artists a on a.id = r.artist_id
  where t.artist_id = r.artist_id and t.is_featured and t.notes ~ '^Feature on .*''s song\.' and t.credit_role is null;
  get diagnostics n = row_count;
  if n not between 6500 and 7500 then raise exception 'unexpected count %, stopping', n; end if;
end $$;
