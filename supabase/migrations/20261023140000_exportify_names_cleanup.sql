-- Exportify (exportify.net) separates a song's artists with ";", but the
-- upload split them on ",". Songs with several artists came through as one
-- made-up artist ("Sematary;Ghost Mountain") and names with a comma were cut
-- ("Tyler, The Creator" became "Tyler"). The upload is fixed; this clears
-- the wrong suggestions and saved counts so the next upload redoes them.
delete from submissions
where type = 'new_artist' and status = 'pending' and payload ->> 'from_spotify' = 'true'
  and (payload ->> 'name' like '%;%' or payload ->> 'name' = 'Tyler');
delete from spotify_artist_suggested where spotify_artist_id like 'name:%;%' or spotify_artist_id = 'name:tyler';
delete from spotify_library_artists where spotify_artist_id like 'name:%';
