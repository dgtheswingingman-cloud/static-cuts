-- Imports can now carry on where they stopped, so a later run may only see
-- part of someone's library. Keep the highest song count seen per artist
-- instead of overwriting it with a smaller one.
do $$
declare
  d text := pg_get_functiondef('public.rpc_suggest_library_artists(jsonb)'::regprocedure);
begin
  if position('songs = greatest(' in d) = 0 then
    d := replace(d, 'songs = excluded.songs,', 'songs = greatest(spotify_library_artists.songs, excluded.songs),');
    if position('songs = greatest(' in d) = 0 then raise exception 'could not update rpc_suggest_library_artists'; end if;
    execute d;
  end if;
end $$;
