-- Trackers' other names: a tracker title cell often has the song's other
-- names in brackets on the next line ("(LET'S SEE, TEXACO, TEXICO)"). The
-- sync now sends them (alt_titles), and a row with no exact title match is
-- matched on them against our titles, or on its title against our songs'
-- aliases, when exactly one main song fits. The tracker's title is then kept
-- as one of that song's aliases.
do $$
declare d text; o text;
begin
  -- 1. sc_sheet_import passes alt_titles through.
  o := pg_get_functiondef('sc_sheet_import(uuid,uuid,jsonb)'::regprocedure);
  d := replace(o, E'      ''title'', trim(it ->> ''title''),\r\n',
                  E'      ''title'', trim(it ->> ''title''),\r\n      ''alt_titles'', coalesce(it -> ''alt_titles'', ''[]''::jsonb),\r\n');
  if d = o then raise exception 'sc_sheet_import patch did not apply'; end if;
  execute d;

  -- 2. sc_sheet_reconcile matches on other names.
  o := pg_get_functiondef('sc_sheet_reconcile(uuid,text,jsonb)'::regprocedure);
  d := replace(o, E'  v_base boolean;\r\nbegin', E'  v_base boolean;\r\n  v_alt text[];\r\n  v_other boolean;\r\nbegin');
  d := replace(d, E'  perform set_config(''static_cuts.credit_user'', '''', true);\r\n',
E'  perform set_config(''static_cuts.credit_user'', '''', true);\r\n  -- Our songs'' other names (aliases), once per run.\r\n  create temp table if not exists _sc_alias_keys (track_id text, key text) on commit drop;\r\n  truncate _sc_alias_keys;\r\n  insert into _sc_alias_keys\r\n  select t.id, sc_title_key(a) from tracks t, unnest(string_to_array(t.aliases, '', '')) a\r\n  where t.artist_id = p_home and t.parent_track_id is null and coalesce(t.aliases, '''') <> '''' and length(sc_title_key(a)) >= 3;\r\n');
  d := replace(d, E'    v_base := false;\r\n',
E'    v_base := false;\r\n    v_other := false;\r\n    if v_ids is null then\r\n      select coalesce(array_agg(distinct k), ''{}'') into v_alt from (\r\n        select sc_title_key(x) k from jsonb_array_elements_text(coalesce(it -> ''alt_titles'', ''[]''::jsonb)) x) y\r\n      where length(k) >= 3 and k <> v_key;\r\n      select array_agg(distinct m.id) into v_ids from (\r\n        select tk.track_id id from track_title_keys tk where tk.artist_id = p_home and tk.is_main and tk.key = any (v_alt)\r\n        union select a.track_id from _sc_alias_keys a where a.key = v_key or a.key = any (v_alt)) m;\r\n      if v_ids is not null and cardinality(v_ids) > 1 then v_ids := null; end if;\r\n      v_other := v_ids is not null;\r\n    end if;\r\n');
  -- Keep the tracker's title as an alias of the song it matched by other name.
  d := replace(d, E'    -- Empty details only.\r\n',
E'    if v_other and not exists (select 1 from unnest(string_to_array(coalesce(t.aliases, ''''), '', '')) a where sc_title_key(a) = v_key) then\r\n      update tracks set aliases = concat_ws('', '', nullif(aliases, ''''), it ->> ''title'') where id = t.id;\r\n    end if;\r\n\r\n    -- Empty details only.\r\n');
  if d = o or position('v_other := v_ids is not null' in d) = 0 or position('_sc_alias_keys (track_id' in d) = 0
     or position('if v_other and not exists' in d) = 0 or position('v_alt text[]' in d) = 0 then
    raise exception 'sc_sheet_reconcile patch did not apply';
  end if;
  execute d;
end $$;

-- Fixes made while testing: "t" is already a variable in this function, the
-- other names are read as text, and "(feat. X)" / "(prod. X)" lines aren't
-- other names.
do $$
declare d text; o text;
begin
  o := pg_get_functiondef('sc_sheet_reconcile(uuid,text,jsonb)'::regprocedure);
  d := replace(o, E'  select t.id, sc_title_key(a) from tracks t, unnest(string_to_array(t.aliases, '', '')) a\r\n  where t.artist_id = p_home and t.parent_track_id is null and coalesce(t.aliases, '''') <> '''' and length(sc_title_key(a)) >= 3;',
                  E'  select tr.id, sc_title_key(al) from tracks tr, unnest(string_to_array(tr.aliases, '', '')) al\r\n  where tr.artist_id = p_home and tr.parent_track_id is null and coalesce(tr.aliases, '''') <> '''' and length(sc_title_key(al)) >= 3;');
  d := replace(d, $x$select sc_title_key(x) k from jsonb_array_elements_text(coalesce(it -> 'alt_titles', '[]'::jsonb)) x) y$x$,
                  $x$select sc_title_key(x.v) k from jsonb_array_elements_text(coalesce(it -> 'alt_titles', '[]'::jsonb)) x(v)) y$x$);
  d := replace(d, $x$      where length(k) >= 3 and k <> v_key;$x$,
                  $x$      where length(k) >= 3 and k <> v_key and k !~ '^(feat|ft|featuring|prod|producedby|with)';$x$);
  if d <> o then execute d; end if;
end $$;
