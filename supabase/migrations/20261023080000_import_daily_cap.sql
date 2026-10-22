-- Spotify import: the daily limit was 20,000 songs a person, which a big
-- library (20,000+ liked songs plus playlists) hits in one go. Raised to
-- 200,000. Reading someone's library costs us nothing (it uses their own
-- Spotify sign-in); only releases we haven't read yet use our allowance, at
-- the usual slow, steady pace.
do $$
declare
  d text := pg_get_functiondef('public.rpc_import_liked_songs(jsonb)'::regprocedure);
begin
  if position('+ v_n > 20000' in d) > 0 then
    d := replace(d, '+ v_n > 20000', '+ v_n > 200000');
    execute d;
  end if;
  if position('+ v_n > 200000' in pg_get_functiondef('public.rpc_import_liked_songs(jsonb)'::regprocedure)) = 0 then
    raise exception 'could not raise the daily limit';
  end if;
end $$;
