-- One artist's collection numbers (era by era) for the "My <artist> card"
-- button on artist pages. Null when logged out or under 3 songs.
create or replace function rpc_my_artist_collection(p_artist text)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select case when auth.uid() is null then null else (
    select r -> 0 from (select rpc_local_missing(array(
      select o.track_id from track_ownership o join tracks t on t.id = o.track_id
      left join tracks p on p.id = t.parent_track_id
      where o.user_id = auth.uid() and coalesce(p.artist_id, t.artist_id) = p_artist limit 5000)) r) x
    where jsonb_typeof(r) = 'array' and jsonb_array_length(r) > 0 and r -> 0 ->> 'artist_id' = p_artist) end;
$$;
grant execute on function rpc_my_artist_collection(text) to authenticated;
