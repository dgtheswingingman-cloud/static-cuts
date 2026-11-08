-- Welcome, last step: "Rate a few". Songs to rate from the artists the person
-- just followed: their most played (ListenBrainz), else released songs with a
-- cover, a couple per artist in turn so one artist doesn't fill the list.
-- Leaves out songs they've already rated.
create or replace function rpc_first_ratings(p_limit int default 12)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  with f as (
    select f.artist_id from follows f where f.user_id = auth.uid()
  ),
  pick as (
    select t.id, t.title, t.album, coalesce(t.cover_url, t.fan_cover_url) cover, a.name artist,
           row_number() over (partition by t.artist_id order by p.listens desc nulls last,
                                (t.cover_url is not null) desc, t.release_date desc nulls last, t.id) rn
    from tracks t
    join f on f.artist_id = t.artist_id
    join artists a on a.id = t.artist_id
    left join track_popularity p on p.track_id = t.id
    where t.parent_track_id is null
      and coalesce(t.release_status, case when t.is_official then 'released' else 'unconfirmed' end) in ('released', 'leaked')
      and not exists (select 1 from ratings r where r.user_id = auth.uid() and r.track_id = t.id)
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'album', album, 'cover', cover, 'artist', artist)
                            order by rn, artist), '[]'::jsonb)
  from (select * from pick where rn <= 3 order by rn, artist limit greatest(1, least(coalesce(p_limit, 12), 30))) x
$$;
revoke execute on function rpc_first_ratings(int) from public, anon;
grant execute on function rpc_first_ratings(int) to authenticated;
