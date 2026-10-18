-- How complete an artist's page is, shown on the artist page.
--
--   status   main songs with a known status (not "unconfirmed")
--   links    released songs with a listen link
--   dates    released songs with a release date
--   albums   released songs with an album
-- score = everything filled in / everything that could be, across all four
-- (so a big artist with mostly unknown statuses doesn't look finished just
-- because their few releases are complete).

create or replace function rpc_artist_completeness(p_artist_id text)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  with t as (
    select coalesce(release_status, case when is_official then 'released' else 'unconfirmed' end) st,
           parent_track_id, spotify_url, release_date, album
    from tracks where artist_id = p_artist_id
  ),
  parts as (
    select 'status' k, count(*) filter (where parent_track_id is null) total,
           count(*) filter (where parent_track_id is null and st <> 'unconfirmed') done from t
    union all
    select 'links', count(*) filter (where st = 'released'), count(*) filter (where st = 'released' and spotify_url is not null) from t
    union all
    select 'dates', count(*) filter (where st = 'released'), count(*) filter (where st = 'released' and release_date is not null) from t
    union all
    select 'albums', count(*) filter (where st = 'released'), count(*) filter (where st = 'released' and album is not null) from t
  )
  select jsonb_build_object(
    'score', (select round(sum(done) * 100.0 / nullif(sum(total), 0)) from parts),
    'parts', (select jsonb_object_agg(k, jsonb_build_object('done', done, 'total', total)) from parts));
$$;

revoke execute on function rpc_artist_completeness(text) from public;
grant execute on function rpc_artist_completeness(text) to anon, authenticated;
