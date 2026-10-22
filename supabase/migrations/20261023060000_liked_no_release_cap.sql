-- Spotify import: every song by an artist in the archive waits for its
-- release to be read. Before, only the first 300 new releases in each batch
-- of 1,000 songs were queued and the rest were quietly dropped (they'd only
-- come through on a second import). The daily limit (20,000 songs per
-- person) still stops anyone flooding the queue.
do $$
declare
  d text := pg_get_functiondef('public.rpc_import_liked_songs(jsonb)'::regprocedure);
begin
  if position('limit 300' in d) > 0 then
    d := replace(d, E'    limit 300\n', E'\n');
    d := replace(d, E'    limit 300\r\n', E'\r\n');
    if position('limit 300' in d) > 0 then raise exception 'could not remove the release cap'; end if;
    execute d;
  end if;
end $$;
