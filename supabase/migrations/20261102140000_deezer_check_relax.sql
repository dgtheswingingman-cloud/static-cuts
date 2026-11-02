-- The Deezer check was holding back 71 artists' new songs on a guess.
-- Deezer adds songs as normal again; the Deezer check list is just a tool
-- for when a page looks wrong. Releases marked "not theirs" stay out.
do $do$
declare d text := pg_get_functiondef('sc_deezer_album_save(text,text,text,jsonb)'::regprocedure);
declare old_line text := 'v_add := not a.catalogue_hold and coalesce(al.review, '''') <> ''remove'' and (al.review = ''keep'' or ((not a.deezer_suspect or coalesce(a.deezer_check, '''') = ''ok'') and coalesce(a.deezer_check, '''') <> ''mixed''));';
begin
  if position(old_line in d) > 0 then
    d := replace(d, old_line, 'v_add := not a.catalogue_hold and coalesce(al.review, '''') <> ''remove'' and (al.review = ''keep'' or coalesce(a.deezer_check, '''') <> ''mixed'');');
    execute d;
  end if;
end;
$do$;
update artists set deezer_check = 'ok' where id = 'hi-c-51dd0b79';
