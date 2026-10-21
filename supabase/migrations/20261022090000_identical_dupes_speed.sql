-- "Identical copies" check (duplicates page): only look closely at titles
-- that appear more than once for an artist, instead of checking every song
-- in the archive first. Same results, 1.7s -> 0.6s (it was hitting the time
-- limit).

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
  from (select * from g order by artist_id, k limit greatest(1, least(coalesce(p_limit, 200), 2000))) g
  join artists ar on ar.id = g.artist_id;

  return result;
end;
$$;
