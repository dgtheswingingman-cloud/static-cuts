-- Imports were slowing the whole site down: every batch of 100 songs looked
-- up each song's Spotify link by reading every song in the archive, so
-- while someone imported, other pages (like the homepage) timed out. This
-- adds an index for that lookup and makes the import use it.

create index if not exists tracks_spotify_sid_idx
  on tracks ((substring(spotify_url from 'track/([A-Za-z0-9]{22})')))
  where spotify_url is not null;
analyze tracks;

do $$
declare
  d text := pg_get_functiondef('public.rpc_import_liked_songs(jsonb)'::regprocedure);
  old text := 'select distinct v_user, h.id from have h join _liked l on l.sid = h.sid';
  new text := 'select distinct v_user, h.id from _liked l join tracks h on h.spotify_url is not null and substring(h.spotify_url from ''track/([A-Za-z0-9]{22})'') = l.sid';
begin
  if position(old in d) > 0 then
    execute replace(d, old, new);
  elsif position(new in d) = 0 then
    raise exception 'could not update rpc_import_liked_songs';
  end if;
end $$;
