-- Matching a listener's songs: when nothing under the artist's own name
-- matches, look at songs they're featured on too (people often file a
-- feature in that artist's folder: Lucki's "Saucin' - Remix" in "Playboi
-- Carti"). The artist's own songs always win.
do $$
declare o text; d text;
begin
  o := pg_get_functiondef('rpc_match_my_songs(jsonb,text)'::regprocedure);
  if position('Songs the artist is featured on' in o) > 0 then return; end if;
  d := replace(o, E'        order by tk.is_main desc limit 1;\n      end if;\n    end if;',
E'        order by tk.is_main desc limit 1;\n      end if;\n      -- Songs the artist is featured on (a feature filed in their folder).\n      if v_track is null then\n        select t.id, t.title into v_track, v_title\n        from track_appearances ap join track_title_keys tk on tk.track_id = ap.track_id join tracks t on t.id = tk.track_id\n        where ap.artist_id = v_artist and (tk.key = v_key or (tk.song_key = v_song and v_song <> \'\'))\n        order by (tk.key = v_key) desc, tk.is_main desc limit 1;\n      end if;\n    end if;');
  if d = o then raise exception 'patch did not apply'; end if;
  execute d;
end $$;
