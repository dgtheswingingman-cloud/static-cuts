-- spotify-match's to-do list timed out overnight: since Deezer added songs it
-- has ~81k songs waiting and re-sorted all of them every run (~2 s, more when
-- busy). Now each artist offers only its first few waiting songs (from an
-- index), which gives the same picks.

create index if not exists tracks_spotify_todo_idx
  on tracks (artist_id, (parent_track_id is null) desc, id)
  where spotify_url is null and spotify_search_attempted_at is null;

create or replace function sc_spotify_match_next(p_limit integer default 10)
returns table(id text, title text, release_status text, album text, release_date date, artist text, others text[])
language sql
stable
security definer
set search_path to 'public'
as $$
  with lim as (select greatest(1, least(coalesce(p_limit, 10), 50)) n),
  arts as (
    select a0.id, a0.name, coalesce(w.weight, 0) wt
    from artists a0
    left join sc_artist_weights() w on w.artist_id = a0.id
    where coalesce(a0.spotify_artist_id, '') !~ '^[A-Za-z0-9]{22}$'
      and not a0.catalogue_hold
  ),
  todo as (
    select x.*, ar.name artist_name, ar.wt
    from arts ar
    cross join lim
    cross join lateral (
      select t.id, t.title, t.release_status, t.album, t.release_date, t.artist_id,
             row_number() over (order by (t.parent_track_id is null) desc, t.id) turn
      from tracks t
      where t.artist_id = ar.id
        and t.spotify_url is null and t.spotify_search_attempted_at is null
        and coalesce(t.release_status, '') not in ('leaked', 'snippet', 'announced', 'rumored', 'teased')
      order by (t.parent_track_id is null) desc, t.id
      limit lim.n
    ) x
  )
  select d.id, d.title, d.release_status, d.album, d.release_date, d.artist_name,
         array(select a2.name from track_appearances ap join artists a2 on a2.id = ap.artist_id where ap.track_id = d.id)
  from todo d
  order by (d.wt > 0) desc, d.turn, d.wt desc, d.artist_id
  limit (select n from lim);
$$;
revoke execute on function sc_spotify_match_next(integer) from public, anon, authenticated;
