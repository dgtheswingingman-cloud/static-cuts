-- Speed pack.
--
-- 1. Duplicates: working out every song's comparison key took ~5 seconds
--    (27,000 songs, each through a text-cleaning function) on every visit to
--    the duplicates page, close to the 8-second limit. The keys are now kept
--    in track_title_keys, updated whenever a song is added or renamed.
-- 2. Guest artist timer: matching guests to artists by name now happens in
--    one pass instead of once per guest, and unchanged guests aren't
--    rewritten every 10 minutes.
-- 3. Indexes on 15 links between tables the database advisor flagged.
-- 4. Imports check against an artist's songs using the stored keys.

-- 1. Title keys -----------------------------------------------------------
create table if not exists track_title_keys (
  track_id text primary key references tracks (id) on delete cascade,
  artist_id text not null,
  is_main boolean not null,
  key text not null,
  song_key text not null default '',
  generic boolean not null
);
alter table track_title_keys add column if not exists song_key text not null default '';
create index if not exists track_title_keys_key on track_title_keys (key) where is_main and not generic and key <> '';
create index if not exists track_title_keys_artist on track_title_keys (artist_id);
alter table track_title_keys enable row level security;
revoke all on track_title_keys from anon, authenticated;

create or replace function sc_track_key_sync()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  k text := sc_title_key(new.title);
begin
  insert into track_title_keys (track_id, artist_id, is_main, key, song_key, generic)
  values (new.id, new.artist_id, new.parent_track_id is null, k, sc_song_key(new.title), sc_is_generic_title(k))
  on conflict (track_id) do update
    set artist_id = excluded.artist_id, is_main = excluded.is_main, key = excluded.key,
        song_key = excluded.song_key, generic = excluded.generic;
  return null;
end;
$$;
drop trigger if exists tracks_key_sync on tracks;
create trigger tracks_key_sync after insert or update of title, artist_id, parent_track_id on tracks
  for each row execute function sc_track_key_sync();

insert into track_title_keys (track_id, artist_id, is_main, key, song_key, generic)
select id, artist_id, parent_track_id is null, k, sc_song_key(title), sc_is_generic_title(k)
from (select id, artist_id, parent_track_id, title, sc_title_key(title) k from tracks) t
on conflict (track_id) do update
  set artist_id = excluded.artist_id, is_main = excluded.is_main, key = excluded.key,
      song_key = excluded.song_key, generic = excluded.generic;
analyze track_title_keys;

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

  with kg as (
    select track_id as id, artist_id, key from track_title_keys
    where is_main and key <> '' and not generic
  ),
  sz as (
    select artist_id, count(distinct key)::int as n from kg group by 1
  ),
  -- Artist pairs that really work together: they share at least 5 titles
  -- and 10% of the smaller catalogue (big catalogues overlap by chance),
  -- or they're already linked through track appearances.
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
  -- Same title on collaborators' pages (only tracks of the strong pairs).
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
  -- Same title twice on one artist's page, unless already in a group above.
  same_g as (
    select kg.key, array_agg(kg.id order by kg.id) as ids, array[kg.artist_id] as artists, 0 as strength
    from kg
    where not exists (select 1 from cross_ok c where c.key = kg.key and kg.id = any (c.ids))
    group by kg.key, kg.artist_id
    having count(*) > 1
  ),
  g2 as (
    select x.*, cardinality(x.artists) as na, sc_group_id(x.ids) as group_id
    from (
      select key, ids, artists, strength from cross_ok
      union all
      select key, ids, artists, strength from same_g
    ) x
  ),
  f as (
    select g2.*,
      (case when exists (select 1 from duplicate_reports r where r.group_id = g2.group_id and r.verdict = 'same') then 1000 else 0 end)
      + (case when g2.na = 1 then 500 else 0 end) + least(g2.strength, 100) as score
    from g2
    where not exists (select 1 from duplicate_dismissals dd where dd.group_id = g2.group_id)
      and not exists (
        select 1 from duplicate_reports r
        where r.group_id = g2.group_id and r.verdict = 'different'
          and not exists (select 1 from duplicate_reports r2 where r2.group_id = r.group_id and r2.verdict = 'same'))
      and (p_artist_id is null or p_artist_id = any (g2.artists)
           or exists (select 1 from unnest(g2.ids) i join track_appearances ap on ap.track_id = i where ap.artist_id = p_artist_id))
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

  with t as (
    select tr.id, tr.artist_id, tr.title, lower(regexp_replace(trim(tr.title), '\s+', ' ', 'g')) as k,
           tr.spotify_url, tr.release_status,
           coalesce(tr.album, '') || '|' || coalesce(tr.release_date::text, '') || '|' ||
           coalesce(tr.producers, '') || '|' || coalesce(tr.genre, '') || '|' || coalesce(tr.notes, '') || '|' ||
           coalesce(tr.track_number::text, '') as details
    from tracks tr
    join track_title_keys tk on tk.track_id = tr.id and not tk.generic
    where tr.parent_track_id is null
      and not exists (select 1 from tracks v where v.parent_track_id = tr.id)
      and not exists (select 1 from track_ownership o where o.track_id = tr.id)
      and not exists (select 1 from ratings r where r.track_id = tr.id)
      and not exists (select 1 from comments c where c.track_id = tr.id)
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

-- Imports compare against an artist's songs using the stored keys too
-- (approving imported songs for big artists took up to 4 seconds).
create or replace function sc_known_keys(p_artist_id text)
returns table (k text, track_id text, spotify_url text, album text, release_date date)
language sql
stable
security definer
set search_path to 'public'
as $$
  with mine as (
    select tr.id, tr.spotify_url, tr.album, tr.release_date, tr.aliases from tracks tr
    where tr.artist_id = p_artist_id
    union
    select tr.id, tr.spotify_url, tr.album, tr.release_date, tr.aliases
    from track_appearances a join tracks tr on tr.id = a.track_id
    where a.artist_id = p_artist_id
  )
  select tk.key, m.id, m.spotify_url, m.album, m.release_date
  from mine m join track_title_keys tk on tk.track_id = m.id
  union all
  select tk.song_key, m.id, m.spotify_url, m.album, m.release_date
  from mine m join track_title_keys tk on tk.track_id = m.id
  where tk.song_key <> tk.key
  union all
  select sc_title_key(al), m.id, m.spotify_url, m.album, m.release_date
  from mine m, regexp_split_to_table(coalesce(m.aliases, ''), '\s*[,;/\n]\s*') al
  where al <> '';
$$;

-- 2. Guest artists --------------------------------------------------------
create or replace function sc_guest_refresh()
returns int
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  g record;
  n int := 0;
begin
  insert into guest_artists (name_key, name, songs)
  select lower(nm), min(nm), count(*)
  from (select sc_guest_name(notes) nm from tracks where notes like 'Feature on %') x
  where nm is not null and nm <> ''
  group by lower(nm)
  on conflict (name_key) do update set songs = excluded.songs, updated_at = now()
  where guest_artists.songs is distinct from excluded.songs;
  update guest_artists ga set songs = 0
  where ga.songs > 0 and not exists (select 1 from tracks where notes like 'Feature on %' and lower(sc_guest_name(notes)) = ga.name_key);
  -- Guests whose name is an artist here, or one of their nicknames.
  update guest_artists ga set artist_id = m.id, state = 'linked', checked_at = now(), note = null
  from (
    select g2.name_key, coalesce(a.id, al.artist_id) as id
    from guest_artists g2
    left join (select id, sc_normalize_title(name) k from artists) a on a.k = sc_normalize_title(g2.name)
    left join artist_aliases al on al.alias_key = sc_normalize_title(g2.name)
    where g2.songs > 0 and g2.artist_id is null and g2.state in ('pending', 'review') and sc_normalize_title(g2.name) <> ''
  ) m
  where m.name_key = ga.name_key and m.id is not null;
  for g in select * from guest_artists where artist_id is not null and songs > 0 loop
    perform set_config('static_cuts.batch_id', '', true);
    perform sc_begin_batch('guests', 'Songs moved to ' || g.name || '''s page');
    n := n + sc_guest_move(g.name_key, g.artist_id);
    update guest_artists set songs = 0 where name_key = g.name_key;
  end loop;
  return n;
end;
$$;

create or replace function sc_guest_next(p_secret text, p_limit int default 8)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then
    raise exception 'not authorized';
  end if;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform sc_guest_refresh();
  return jsonb_build_object(
    'known', (select coalesce(jsonb_object_agg(spotify_artist_id, id), '{}'::jsonb) from artists where spotify_artist_id is not null),
    'guests', (
      with picked as (
        select * from guest_artists where state = 'pending' and songs > 0
        order by songs desc, name limit greatest(1, least(coalesce(p_limit, 8), 20))
      ), titles as (
        select lower(sc_guest_name(t.notes)) k, t.title, row_number() over (partition by lower(sc_guest_name(t.notes)) order by t.id) rn
        from tracks t
        where t.notes like 'Feature on %' and lower(sc_guest_name(t.notes)) in (select name_key from picked)
      )
      select coalesce(jsonb_agg(jsonb_build_object('key', p.name_key, 'name', p.name,
               'titles', (select jsonb_agg(ti.title) from titles ti where ti.k = p.name_key and ti.rn <= 3))), '[]'::jsonb)
      from picked p));
end;
$$;

-- 3. Indexes the advisor flagged -----------------------------------------
create index if not exists artist_genre_tag_votes_user_idx on artist_genre_tag_votes (user_id);
create index if not exists artist_genre_tags_created_by_idx on artist_genre_tags (created_by);
create index if not exists change_batches_undo_batch_idx on change_batches (undo_batch_id);
create index if not exists comment_reports_user_idx on comment_reports (user_id);
create index if not exists comment_votes_user_idx on comment_votes (user_id);
create index if not exists discoveries_submission_idx on discoveries (submission_id);
create index if not exists guest_artists_artist_idx on guest_artists (artist_id);
create index if not exists sheet_requests_requested_by_idx on sheet_requests (requested_by);
create index if not exists sheet_requests_source_idx on sheet_requests (source_id);
create index if not exists sheet_sources_added_by_idx on sheet_sources (added_by);
create index if not exists sheet_sources_artist_idx on sheet_sources (artist_id);
create index if not exists submissions_reviewed_by_idx on submissions (reviewed_by);
create index if not exists takedown_requests_artist_idx on takedown_requests (artist_id);
create index if not exists track_link_candidate_votes_user_idx on track_link_candidate_votes (user_id);
create index if not exists track_status_events_source_submission_idx on track_status_events (source_submission_id);

select (select count(*) from track_title_keys) as title_keys, (select count(*) from tracks) as songs;
