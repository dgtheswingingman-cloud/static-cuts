-- Genius checks every song once, whatever it already has (it also gives
-- dates, albums, writers and samples, not just producers / features / cover).
do $$
declare d text; o text;
begin
  o := pg_get_functiondef('sc_genius_credit_next(text,int)'::regprocedure);
  d := replace(o, $x$where t.genius_checked_at is null and t.genius_song_id is not null and (t.producers is null or t.featured_artists is null or t.cover_url is null)$x$,
                  $x$where t.genius_checked_at is null and t.genius_song_id is not null$x$);
  d := replace(d, $x$where t.artist_id = a.id and t.genius_checked_at is null and t.genius_song_id is null
        and (t.producers is null or t.featured_artists is null or t.cover_url is null)$x$,
                  $x$where t.artist_id = a.id and t.genius_checked_at is null and t.genius_song_id is null$x$);
  if d = o or position('t.genius_song_id is null
        and (t.producers' in d) > 0 then raise exception 'patch did not apply'; end if;
  execute d;
end $$;
-- Faster normal pace (every 3 minutes, see genius-credits): room for ~2 requests a song.
update sc_private_settings set value = '10000' where key = 'genius_per_day';
