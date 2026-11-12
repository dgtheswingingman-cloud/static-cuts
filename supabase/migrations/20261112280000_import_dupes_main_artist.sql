-- Import review: a song suggested through another artist's import (e.g. a
-- producer's Genius page suggesting Playboi Carti songs) goes on its main
-- artist's page, but the duplicate check only looked at the producer's page,
-- so songs the main artist already had were added again. Check both.
do $$
declare o text; d text;
begin
  o := pg_get_functiondef('admin_apply_import_suggestions(uuid[],text)'::regprocedure);
  d := replace(o,
E'  for s in select * from import_suggestions where id = any (p_ids[1:300]) and state = ''open'' order by title loop\r\n    if exists (select 1 from _sc_apply_known where artist_id = s.artist_id\r\n               and k in (sc_title_key(s.title), sc_song_key(s.title))) then',
E'  for s in select * from import_suggestions where id = any (p_ids[1:300]) and state = ''open'' order by title loop\r\n    -- The song goes on its main artist''s page when it has one, so check that\r\n    -- page too (a producer''s import suggests the main artist''s songs).\r\n    v_main := case when s.main_artist_name is not null then sc_find_artist(s.main_artist_name) end;\r\n    if v_main is not null and v_main <> s.artist_id and not exists (select 1 from _sc_apply_known where artist_id = v_main limit 1) then\r\n      insert into _sc_apply_known select v_main, k.k from sc_known_keys(v_main) k;\r\n    end if;\r\n    if exists (select 1 from _sc_apply_known where artist_id in (s.artist_id, coalesce(v_main, s.artist_id))\r\n               and k in (sc_title_key(s.title), sc_song_key(s.title))) then');
  d := replace(d, E'           where k.artist_id = s.artist_id and (k.key = sc_title_key(s.title)',
                  E'           where k.artist_id in (s.artist_id, coalesce(v_main, s.artist_id)) and (k.key = sc_title_key(s.title)');
  d := replace(d, E'    insert into _sc_apply_known values (s.artist_id, sc_title_key(s.title)), (s.artist_id, sc_song_key(s.title));',
                  E'    insert into _sc_apply_known values (s.artist_id, sc_title_key(s.title)), (s.artist_id, sc_song_key(s.title)),\r\n                                       (v_home, sc_title_key(s.title)), (v_home, sc_song_key(s.title));');
  if d = o or position('check that' in d) = 0 or position('(v_home, sc_title_key' in d) = 0
     or position('k.artist_id in (s.artist_id, coalesce(v_main' in d) = 0 then
    raise exception 'patch did not apply';
  end if;
  execute d;
end $$;
