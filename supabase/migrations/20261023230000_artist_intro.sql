-- The pinned intro at the top of an artist page: a few key facts and a
-- "start here" pick of songs (best rated and most collected, songs you can
-- listen to first).

create or replace function rpc_artist_intro(p_artist text)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  with main as (
    select t.* from tracks t where t.artist_id = p_artist and t.parent_track_id is null
  ), dates as (
    select coalesce(release_date, leak_date) d from main where coalesce(release_date, leak_date) is not null
  ), rated as (
    select r.track_id, avg(r.value)::numeric(4,1) avg, count(*) n from ratings r join main m on m.id = r.track_id group by r.track_id
  ), owned as (
    select o.track_id, count(*) n from track_ownership o join main m on m.id = o.track_id group by o.track_id
  ), pick as (
    select m.id, m.title, m.release_status, m.spotify_url, m.cover_url, ra.avg, coalesce(ra.n, 0) ratings, coalesce(ow.n, 0) collected,
           coalesce(ra.avg, 0) * least(coalesce(ra.n, 0), 5) + 2 * coalesce(ow.n, 0) + case when m.spotify_url is not null then 3 else 0 end score
    from main m left join rated ra on ra.track_id = m.id left join owned ow on ow.track_id = m.id
  )
  select jsonb_build_object(
    'songs', (select count(*) from main),
    'released', (select count(*) from main where release_status = 'released'),
    'unreleased', (select count(*) from main where release_status in ('leaked', 'snippet', 'teased', 'announced', 'rumored')),
    'leaked', (select count(*) from main where release_status = 'leaked'),
    'first_year', (select extract(year from min(d))::int from dates),
    'last_year', (select extract(year from max(d))::int from dates),
    'followers', (select count(*) from follows where artist_id = p_artist),
    'collectors', (select count(distinct o.user_id) from track_ownership o join main m on m.id = o.track_id),
    'start_here', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'status', release_status, 'spotify_url', spotify_url,
                                                              'cover_url', cover_url, 'avg', avg, 'ratings', ratings, 'collected', collected)
                                           order by score desc, title), '[]'::jsonb)
                   from (select * from pick where score > 0 order by score desc, title limit 5) p)
  );
$$;
grant execute on function rpc_artist_intro(text) to anon, authenticated;
