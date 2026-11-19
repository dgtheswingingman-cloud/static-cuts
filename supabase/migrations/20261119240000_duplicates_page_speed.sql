-- Duplicates page: 0.55 s -> well under 0.1 s. It used to re-check every
-- one of ~14,500 groups against tracks (in case songs were deleted since the
-- hourly scan) before picking a page of 20. Now it picks the page from the
-- scan, then re-checks just those groups (plus a few spare, so a group that
-- has lost its songs since the scan is dropped and the page stays full).
-- The total can be a group or two high until the next hourly scan.
create or replace function find_duplicate_groups(p_artist_id text default null, p_limit integer default 20, p_offset integer default 0)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
set work_mem to '64MB'
as $function$
declare
  result jsonb;
  total int;
  v_limit int := greatest(1, least(coalesce(p_limit, 20), 100));
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;

  with f as (
    select d.group_id, d.key, d.ids, d.artists, cardinality(d.artists) as na,
      (case when exists (select 1 from duplicate_reports r where r.group_id = d.group_id and r.verdict = 'same') then 1000 else 0 end)
      + (case when cardinality(d.artists) = 1 then 500 else 0 end) + least(d.strength, 100) as score
    from duplicate_candidates d
    where cardinality(d.ids) > 1
      and (p_artist_id is null or p_artist_id = any (d.artists)
           or exists (select 1 from unnest(d.ids) i join track_appearances ap on ap.track_id = i where ap.artist_id = p_artist_id))
      and not exists (select 1 from duplicate_dismissals dd where dd.group_id = d.group_id)
      and not exists (
        select 1 from duplicate_reports r
        where r.group_id = d.group_id and r.verdict = 'different'
          and not exists (select 1 from duplicate_reports r2 where r2.group_id = r.group_id and r2.verdict = 'same'))
  ),
  counted as (select count(*)::int n from f),
  raw as (
    select * from f order by score desc, key
    limit v_limit + 10 offset greatest(coalesce(p_offset, 0), 0)
  ),
  page as (
    select r.group_id, r.key, r.na, r.score, live.ids
    from raw r
    cross join lateral (select array_agg(t.id order by t.id) ids from tracks t where t.id = any (r.ids)) live
    where cardinality(live.ids) > 1
    order by r.score desc, r.key
    limit v_limit
  )
  select
    (select n from counted),
    coalesce(jsonb_agg(jsonb_build_object(
      'group_id', page.group_id,
      'key', page.key,
      'score', page.score,
      'same_artist', page.na = 1,
      'tracks', (
        select jsonb_agg(jsonb_build_object(
          'track_id', t.id,
          'artist_id', t.artist_id,
          'artist_name', ar.name,
          'title', t.title,
          'status', t.release_status,
          'link', t.spotify_url,
          'release_date', t.release_date,
          'aliases', t.aliases,
          'versions', (select count(*) from tracks v where v.parent_track_id = t.id),
          'collected', (select count(*) from track_ownership o where o.track_id = t.id),
          'ratings', (select count(*) from ratings r where r.track_id = t.id),
          'comments', (select count(*) from comments c where c.track_id = t.id),
          'appears_on', (select coalesce(jsonb_agg(ap.artist_id), '[]'::jsonb) from track_appearances ap where ap.track_id = t.id)
        ) order by release_status_rank(t.release_status) desc, (t.spotify_url is null), t.id)
        from tracks t join artists ar on ar.id = t.artist_id
        where t.id = any (page.ids)
      ),
      'reports', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'verdict', r.verdict, 'confidence', r.confidence, 'source_url', r.source_url, 'notes', r.notes)), '[]'::jsonb)
        from duplicate_reports r where r.group_id = page.group_id
      )
    ) order by page.score desc, page.key), '[]'::jsonb)
  into total, result
  from page;

  return jsonb_build_object('total', coalesce(total, 0), 'groups', result);
end;
$function$;
