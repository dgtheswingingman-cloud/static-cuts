-- Spotify/Exportify imports: everyone's songs are added straight away (and
-- songs by artists not here yet are kept until the artist is approved), not
-- just trusted people's. The song details come from the person's own Spotify.
do $$
declare
  d text := pg_get_functiondef('public.rpc_import_liked_songs(jsonb)'::regprocedure);
begin
  if position('v_trusted := true;' in d) = 0 then
    d := replace(d, 'v_trusted := is_owner() or is_moderator() or sc_is_trusted(v_user);', 'v_trusted := true;');
    if position('v_trusted := true;' in d) = 0 then raise exception 'could not update rpc_import_liked_songs'; end if;
    execute d;
  end if;
end $$;
