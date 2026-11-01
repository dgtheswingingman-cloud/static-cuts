-- Quick merge on the possible duplicates page: "canceling statement due to
-- statement timeout". Finding identical copies means tidying every title on
-- the site (206,000+ songs), which now takes 8-15 seconds, over the 8 second
-- limit for signed-in requests.
--
-- Now the search runs in the background every 15 minutes (no time limit
-- there) and is saved; the page reads the saved list. Each saved group is
-- checked again against the songs as they are now before it's shown, so a
-- group whose songs were merged, removed or edited since is left out.

-- The search itself (unchanged from find_identical_duplicates).
create or replace function sc_identical_duplicates_live(p_limit integer default 2000)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
set work_mem to '64MB'
as $$
declare
  result jsonb;
begin
  with cand as (
    select tr.artist_id, lower(regexp_replace(trim(tr.title), '\s+', ' ', 'g')) as k
    from tracks tr
    where tr.parent_track_id is null
    group by 1, 2
    having count(*) > 1
  ),
  t as (
    select tr.id, tr.artist_id, tr.title, c.k, tr.spotify_url, tr.release_status,
           coalesce(tr.album, '') || '|' || coalesce(tr.release_date::text, '') || '|' ||
           coalesce(tr.producers, '') || '|' || coalesce(tr.genre, '') || '|' || coalesce(tr.notes, '') || '|' ||
           coalesce(tr.track_number::text, '') as details
    from cand c
    join tracks tr on tr.artist_id = c.artist_id and tr.parent_track_id is null
                  and lower(regexp_replace(trim(tr.title), '\s+', ' ', 'g')) = c.k
    join track_title_keys tk on tk.track_id = tr.id and not tk.generic
    where not exists (select 1 from tracks v where v.parent_track_id = tr.id)
      and not exists (select 1 from track_ownership o where o.track_id = tr.id)
      and not exists (select 1 from ratings r where r.track_id = tr.id)
      and not exists (select 1 from comments c2 where c2.track_id = tr.id)
  ),
  g as (
    select t.artist_id, t.k, array_agg(t.id order by t.id) as ids, min(t.title) as title, count(*)::int as n
    from t
    group by t.artist_id, t.k
    having count(*) > 1
       and count(distinct t.details) = 1
       and count(distinct t.release_status) = 1
       and count(t.spotify_url) <= 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'artist_id', g.artist_id, 'artist_name', ar.name, 'title', g.title, 'copies', g.n, 'track_ids', to_jsonb(g.ids)
  ) order by ar.name, g.title), '[]'::jsonb)
  into result
  from (select * from g order by artist_id, k limit greatest(1, least(coalesce(p_limit, 2000), 2000))) g
  join artists ar on ar.id = g.artist_id;
  return result;
end;
$$;
revoke execute on function sc_identical_duplicates_live(integer) from public, anon, authenticated;

create or replace function sc_identical_duplicates_refresh()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into home_cache (key, data, refreshed_at)
  values ('identical_duplicates', sc_identical_duplicates_live(2000), now())
  on conflict (key) do update set data = excluded.data, refreshed_at = excluded.refreshed_at;
end;
$$;
revoke execute on function sc_identical_duplicates_refresh() from public, anon, authenticated;

-- What the page calls: the saved groups that are still identical copies.
create or replace function find_identical_duplicates(p_limit integer default 200)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  result jsonb;
begin
  if not is_moderator() then raise exception 'not authorized'; end if;

  with saved as (
    select g, array(select jsonb_array_elements_text(g -> 'track_ids')) as ids
    from home_cache hc, jsonb_array_elements(hc.data) g
    where hc.key = 'identical_duplicates'
  ),
  still as (
    select s.g from saved s
    where (select count(*) = cardinality(s.ids)
                  and count(distinct coalesce(t.album, '') || '|' || coalesce(t.release_date::text, '') || '|' ||
                        coalesce(t.producers, '') || '|' || coalesce(t.genre, '') || '|' || coalesce(t.notes, '') || '|' ||
                        coalesce(t.track_number::text, '')) = 1
                  and count(distinct t.release_status) = 1
                  and count(distinct lower(regexp_replace(trim(t.title), '\s+', ' ', 'g'))) = 1
                  and count(t.spotify_url) <= 1
                  and bool_and(t.parent_track_id is null)
           from tracks t where t.id = any (s.ids))
      and not exists (select 1 from tracks v where v.parent_track_id = any (s.ids))
      and not exists (select 1 from track_ownership o where o.track_id = any (s.ids))
      and not exists (select 1 from ratings r where r.track_id = any (s.ids))
      and not exists (select 1 from comments c where c.track_id = any (s.ids))
    limit greatest(1, least(coalesce(p_limit, 200), 2000))
  )
  select coalesce(jsonb_agg(g), '[]'::jsonb) into result from still;
  return result;
end;
$$;

-- Fill it now, then every 15 minutes (off the hour, away from the other jobs).
select sc_identical_duplicates_refresh();
select cron.unschedule(jobid) from cron.job where jobname = 'identical-duplicates';
select cron.schedule('identical-duplicates', '4,19,34,49 * * * *', 'select sc_identical_duplicates_refresh()');
