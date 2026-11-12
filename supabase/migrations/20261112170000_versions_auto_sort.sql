-- Version suggestions settle themselves as the song checks bring in data:
-- 1. The hourly auto-clear also takes the same Genius page, or the same
--    Deezer / Apple / Spotify link, as "clearly the same song" (as well as
--    the same ISRC or lengths within 2 seconds).
-- 2. Songs in open suggestions go next in the Deezer / Apple checks (after
--    the launch artists), so they get lengths and ISRCs sooner.
do $$
declare d text; o text;
begin
  o := pg_get_functiondef('sc_version_auto_clear()'::regprocedure);
  d := replace(o, $x$or (t.length_sec is not null and p.length_sec is not null and abs(t.length_sec - p.length_sec) <= 2)$x$,
    $x$or (t.length_sec is not null and p.length_sec is not null and abs(t.length_sec - p.length_sec) <= 2)
        or (t.genius_song_id is not null and t.genius_song_id = p.genius_song_id)
        or (t.deezer_url is not null and t.deezer_url = p.deezer_url)
        or (t.apple_url is not null and t.apple_url = p.apple_url)
        or (t.spotify_url is not null and t.spotify_url = p.spotify_url)$x$);
  if d = o then raise exception 'auto-clear patch did not apply'; end if;
  execute d;

  o := pg_get_functiondef('sc_song_check_next(text,text,int)'::regprocedure);
  d := replace(o, 'order by exists (select 1 from launch_artists l where l.artist_id = t.artist_id) desc,',
    'order by exists (select 1 from launch_artists l where l.artist_id = t.artist_id) desc,
             (exists (select 1 from version_suggestions vs where vs.state = ''open'' and vs.track_id = t.id)
              or exists (select 1 from version_suggestions vs where vs.state = ''open'' and vs.parent_track_id = t.id)) desc,');
  if d = o then raise exception 'song-check patch did not apply'; end if;
  execute d;
end $$;
