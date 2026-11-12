-- rpc_match_my_songs was slow enough that Local Cuts' batches of 200 hit
-- the 8 second limit and failed whole (every song in the batch unmatched):
-- sc_find_artist (~75 ms) ran once per song, even when all 200 named the
-- same artist. Now each artist name is looked up once per call, and the
-- "featured on" look-up goes through the title index. 200 songs: 18.5 s -> 0.8 s.
do $$
declare o text; d text;
begin
  o := pg_get_functiondef('rpc_match_my_songs(jsonb,text)'::regprocedure);
  if position('v_seen ? v_name' in o) > 0 then return; end if;
  d := replace(o, E'        from track_appearances ap join track_title_keys tk on tk.track_id = ap.track_id join tracks t on t.id = tk.track_id\n        where ap.artist_id = v_artist and (tk.key = v_key or (tk.song_key = v_song and v_song <> \'\'))\n        order by (tk.key = v_key) desc, tk.is_main desc limit 1;',
                  E'        from track_title_keys tk join tracks t on t.id = tk.track_id\n        where tk.is_main and tk.key = v_key\n          and exists (select 1 from track_appearances ap where ap.track_id = tk.track_id and ap.artist_id = v_artist)\n        limit 1;');
  d := replace(d, E'  n int := 0;\nbegin', E'  n int := 0;\n  v_seen jsonb := \'{}\'::jsonb; -- artist names already looked up in this call\n  v_name text;\nbegin');
  d := replace(d, E'    v_artist := coalesce(p_artist_id, sc_find_artist(it ->> \'artist\'));',
                  E'    v_name := lower(btrim(coalesce(it ->> \'artist\', \'\')));\n    if p_artist_id is not null then v_artist := p_artist_id;\n    elsif v_seen ? v_name then v_artist := v_seen ->> v_name;\n    else v_artist := sc_find_artist(it ->> \'artist\'); v_seen := v_seen || jsonb_build_object(v_name, v_artist);\n    end if;');
  if d = o or position('v_seen ? v_name' in d) = 0 then raise exception 'patch did not apply'; end if;
  execute d;
end $$;
