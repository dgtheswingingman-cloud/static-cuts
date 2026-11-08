-- Artist page: "Most played", from ListenBrainz play counts.
create or replace function rpc_artist_most_played(p_artist text, p_limit int default 10)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_agg(x order by x.listens desc), '[]'::jsonb) from (
    select t.id, t.title, t.album, coalesce(t.cover_url, t.fan_cover_url) cover,
           coalesce(t.release_status, case when t.is_official then 'released' else 'unconfirmed' end) status,
           p.listens, p.listeners
    from tracks t join track_popularity p on p.track_id = t.id
    where t.artist_id = p_artist and t.parent_track_id is null and p.listens > 0
    order by p.listens desc limit greatest(1, least(coalesce(p_limit, 10), 50))
  ) x
$$;
grant execute on function rpc_artist_most_played(text, int) to anon, authenticated;
