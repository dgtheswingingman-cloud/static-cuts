-- Security check tidy-up (Supabase's advisor):
--  * Trigger functions can't do anything when called directly, but they
--    don't need to be callable from the website at all.
--  * Two small helper functions get a fixed search_path.
-- The four "security definer" views (rating stats, completion stats, genre
-- tag votes) are left as they are on purpose: they show totals across
-- everyone, which people can't read row by row.

revoke execute on function sc_artists_apply_held() from public, anon, authenticated;
revoke execute on function sc_artists_apply_held_new() from public, anon, authenticated;
revoke execute on function sc_artists_hold_new() from public, anon, authenticated;
revoke execute on function sc_message_notify() from public, anon, authenticated;
revoke execute on function sc_new_artist_spotify_link() from public, anon, authenticated;
revoke execute on function sc_user_follow_notify() from public, anon, authenticated;
revoke execute on function sc_hold_new_catalogues() from public, anon, authenticated;

alter function sc_genre_slug(text) set search_path = public;
do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'sc_url_host' loop
    execute format('alter function %s set search_path = public', f);
  end loop;
end $$;
