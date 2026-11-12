-- Song checks: songs already found on another service (or with an ISRC) go
-- first, since they're the ones most likely to be on this one too. Songs
-- with nothing anywhere (often SoundCloud-only) come after.
do $$
declare d text;
begin
  d := pg_get_functiondef('sc_song_check_next(text,text,int)'::regprocedure);
  d := replace(d, $o$(t.release_status = 'released') desc,$o$,
    $n$(t.isrc is not null or t.spotify_url is not null or t.deezer_url is not null or t.apple_url is not null) desc,
             (t.release_status = 'released') desc,$n$);
  if d = pg_get_functiondef('sc_song_check_next(text,text,int)'::regprocedure) then raise exception 'no change'; end if;
  execute d;
end $$;
