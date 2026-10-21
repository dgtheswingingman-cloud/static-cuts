-- Speed pack: 1. sitemap in parts  2. duplicates worked out hourly.

-- Sitemap in parts: search engines read at most 50,000 links per sitemap,
-- and the archive has more songs than that. Each part asks for one slice of
-- song ids (part 0 also gets every artist), which is also quick enough to
-- never hit the time limit for visitors.

create or replace function rpc_sitemap_part(p_offset int default 0, p_limit int default 40000)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select jsonb_build_object(
    'artists', case when coalesce(p_offset, 0) = 0
                    then (select coalesce(jsonb_agg(id order by id), '[]'::jsonb) from artists) else '[]'::jsonb end,
    'songs', (select coalesce(jsonb_agg(id), '[]'::jsonb)
              from (select id from tracks order by id offset greatest(coalesce(p_offset, 0), 0)
                    limit least(greatest(coalesce(p_limit, 40000), 1), 45000)) s)
  );
$$;
grant execute on function rpc_sitemap_part(int, int) to anon, authenticated;

-- ----------------------------------------------------------------- 2

-- Duplicates: the possible-duplicate groups worked out once an hour instead
-- of on every visit. Working them out compares every title in the archive
-- (2-3 seconds and growing), and the duplicates page and ChatGPT's
-- get_possible_duplicates both ran it each time, sometimes hitting the time
-- limit. Dismissals, reports and merges still show straight away: those are
-- checked live against the hourly list.

create table if not exists duplicate_candidates (
  group_id text primary key,
  key text not null,
  ids text[] not null,
  artists text[] not null,
  strength int not null default 0
);
alter table duplicate_candidates enable row level security;
revoke all on duplicate_candidates from anon, authenticated;

create or replace function sc_refresh_duplicate_candidates()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_n int;
begin
  create temp table _dc on commit drop as
  with kg as (
    select track_id as id, artist_id, key from track_title_keys
    where is_main and key <> '' and not generic
  ),
  sz as (
    select artist_id, count(distinct key)::int as n from kg group by 1
  ),
  -- Artist pairs that really work together: they share at least 5 titles
  -- and 10% of the smaller catalogue, or they're linked through appearances.
  pair as (
    select a.artist_id as a1, b.artist_id as a2, count(distinct a.key)::int as shared
    from kg a join kg b on a.key = b.key and a.artist_id < b.artist_id
    group by 1, 2
  ),
  linked as (
    select least(t.artist_id, ap.artist_id) as a1, greatest(t.artist_id, ap.artist_id) as a2
    from track_appearances ap join tracks t on t.id = ap.track_id
    where t.artist_id <> ap.artist_id
    group by 1, 2
  ),
  strong as (
    select p.a1, p.a2, (100 * p.shared / least(s1.n, s2.n))::int as strength
    from pair p
    join sz s1 on s1.artist_id = p.a1
    join sz s2 on s2.artist_id = p.a2
    where (p.shared >= 5 and p.shared::numeric / least(s1.n, s2.n) >= 0.10)
       or exists (select 1 from linked l where l.a1 = p.a1 and l.a2 = p.a2)
  ),
  cross_ok as (
    select a.key,
           array_agg(distinct x.id order by x.id) as ids,
           array_agg(distinct x.artist_id) as artists,
           max(st.strength) as strength
    from kg a
    join kg b on a.key = b.key and a.artist_id < b.artist_id
    join strong st on st.a1 = a.artist_id and st.a2 = b.artist_id
    cross join lateral (values (a.id, a.artist_id), (b.id, b.artist_id)) x(id, artist_id)
    group by a.key
  ),
  same_g as (
    select kg.key, array_agg(kg.id order by kg.id) as ids, array[kg.artist_id] as artists, 0 as strength
    from kg
    where not exists (select 1 from cross_ok c where c.key = kg.key and kg.id = any (c.ids))
    group by kg.key, kg.artist_id
    having count(*) > 1
  )
  select distinct on (group_id) group_id, key, ids, artists, strength
  from (
    select sc_group_id(x.ids) as group_id, x.*
    from (select key, ids, artists, strength from cross_ok
          union all
          select key, ids, artists, strength from same_g) x
  ) y
  order by group_id, strength desc;
  delete from duplicate_candidates;
  insert into duplicate_candidates (group_id, key, ids, artists, strength) select group_id, key, ids, artists, strength from _dc;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke execute on function sc_refresh_duplicate_candidates() from public, anon, authenticated;

select sc_refresh_duplicate_candidates() as duplicate_groups;

-- Same answer as before, read from the hourly list. Songs merged or deleted
-- since the last refresh drop out of their group; groups left with one song
-- disappear.
create or replace function find_duplicate_groups(p_artist_id text default null, p_limit integer default 20, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  result jsonb;
  total int;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;

  with g2 as (
    select d.group_id, d.key, live.ids, d.artists, d.strength, cardinality(d.artists) as na
    from duplicate_candidates d
    cross join lateral (select array_agg(t.id order by t.id) ids from tracks t where t.id = any (d.ids)) live
    where (p_artist_id is null or p_artist_id = any (d.artists)
           or exists (select 1 from unnest(d.ids) i join track_appearances ap on ap.track_id = i where ap.artist_id = p_artist_id))
  ),
  f as (
    select g2.*,
      (case when exists (select 1 from duplicate_reports r where r.group_id = g2.group_id and r.verdict = 'same') then 1000 else 0 end)
      + (case when g2.na = 1 then 500 else 0 end) + least(g2.strength, 100) as score
    from g2
    where cardinality(g2.ids) > 1
      and not exists (select 1 from duplicate_dismissals dd where dd.group_id = g2.group_id)
      and not exists (
        select 1 from duplicate_reports r
        where r.group_id = g2.group_id and r.verdict = 'different'
          and not exists (select 1 from duplicate_reports r2 where r2.group_id = r.group_id and r2.verdict = 'same'))
  ),
  page as (
    select *, count(*) over () as total_count
    from f
    order by score desc, key
    limit greatest(1, least(coalesce(p_limit, 20), 100))
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select
    coalesce(max(page.total_count), 0),
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

  return jsonb_build_object('total', total, 'groups', result);
end;
$$;

select cron.schedule('duplicate-refresh', '17 * * * *', $$ select public.sc_refresh_duplicate_candidates(); $$);
