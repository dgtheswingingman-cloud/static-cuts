-- Credits (9 Nov 2026): producers, features and remixers as one index.
--
-- track_people: who is credited on each song, kept up to date by a trigger:
--   producer  from the producers field
--   feature   from the featured artists field and "(feat. X)" in the title
--   remixer   from "(X Remix)", "(X Flip)", "(X Bootleg)" in the title
-- The person's own page (/producer/<name>) shows everything they're credited
-- on, and is now fast (it split every producer field on every visit).
--
-- Features that name exactly one artist in the archive (by name or alias)
-- are linked to that artist's page, so the song shows on it as a feature.

create or replace function sc_name_key(p text)
returns text language sql immutable parallel safe as $$
  select nullif(lower(regexp_replace(coalesce(p, ''), '[^[:alnum:]]', '', 'g')), '')
$$;

create table if not exists track_people (
  track_id text not null references tracks(id) on delete cascade,
  role text not null check (role in ('producer', 'feature', 'remixer')),
  name text not null,
  name_key text not null,
  primary key (track_id, role, name_key)
);
create index if not exists track_people_name_idx on track_people (name_key, role);
alter table track_people enable row level security;
create policy "credits are public" on track_people for select using (true);

create or replace function sc_track_people_names(p_title text, p_producers text, p_feat text)
returns table(role text, name text) language sql immutable parallel safe set search_path to 'public' as $$
  select 'producer', n from sc_split_names(p_producers) n
  union
  select 'feature', n from sc_split_names(p_feat) n
  union
  select 'feature', n from sc_split_names((regexp_match(p_title, '[\(\[]\s*(?:feat\.?|ft\.?|featuring)\s+([^\)\]]+)[\)\]]', 'i'))[1]) n
  union
  select 'feature', n from sc_split_names((regexp_match(p_title, '\s(?:feat\.|ft\.|featuring)\s+([^\(\)\[\]]+)$', 'i'))[1]) n
  union
  select 'remixer', n from sc_split_names((regexp_match(p_title, '[\(\[]([^\(\)\[\]]+?)\s+(?:remix|rmx|flip|bootleg)\s*[\)\]]', 'i'))[1]) n
  where n !~* '^(the\s+)?(extended|radio|club|original|official|album|clean|dirty|vip|dub|instrumental|acoustic|live|short|long|single|explicit|main|alt|alternate|full|mix|new|old|demo|bonus|unreleased|leaked|remix|my|our|slowed|sped up|chopped|screwed|reverb|trap|house|dance|dubstep|drill|jersey|amapiano|acapella|v\d+|\d+)$'
$$;

create index if not exists artists_name_key_idx on artists (sc_name_key(name));
create index if not exists artist_aliases_name_key_idx on artist_aliases (sc_name_key(alias));

-- The artist a name points to unambiguously (name or alias).
create or replace function sc_artist_by_name_key(p_key text)
returns text language sql stable set search_path to 'public' as $$
  select min(id) from (
    select a.id from artists a where sc_name_key(a.name) = p_key
    union select x.artist_id from artist_aliases x where sc_name_key(x.alias) = p_key
  ) z having count(distinct id) = 1
$$;

create or replace function sc_track_people_sync()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare v_self text;
begin
  select sc_name_key(name) into v_self from artists where id = new.artist_id;
  delete from track_people where track_id = new.id;
  insert into track_people (track_id, role, name, name_key)
  select distinct on (p.role, sc_name_key(p.name)) new.id, p.role, p.name, sc_name_key(p.name)
  from sc_track_people_names(new.title, new.producers, new.featured_artists) p
  where sc_name_key(p.name) is not null and (p.role = 'producer' or sc_name_key(p.name) is distinct from v_self)
  order by p.role, sc_name_key(p.name), p.name;
  -- Link features to the artist they unambiguously name.
  insert into track_appearances (track_id, artist_id)
  select new.id, a.id
  from track_people p cross join lateral (select sc_artist_by_name_key(p.name_key) id) a
  where p.track_id = new.id and p.role = 'feature' and a.id is not null and a.id <> new.artist_id
  on conflict do nothing;
  return null;
end $function$;

drop trigger if exists tracks_people_sync on tracks;
create trigger tracks_people_sync after insert or update of title, producers, featured_artists, artist_id on tracks
  for each row execute function sc_track_people_sync();

-- Backfill.
with a as (select id, sc_name_key(name) self from artists)
insert into track_people (track_id, role, name, name_key)
select distinct on (t.id, p.role, sc_name_key(p.name)) t.id, p.role, p.name, sc_name_key(p.name)
from tracks t join a on a.id = t.artist_id
cross join lateral sc_track_people_names(t.title, t.producers, t.featured_artists) p
where (t.producers is not null or t.featured_artists is not null or t.title ~* '(feat|ft\.|featuring|remix|rmx|flip|bootleg)')
  and sc_name_key(p.name) is not null and (p.role = 'producer' or sc_name_key(p.name) is distinct from a.self)
order by t.id, p.role, sc_name_key(p.name), p.name
on conflict do nothing;

with keys as (
  select k, min(id) id from (
    select sc_name_key(name) k, id from artists
    union select sc_name_key(alias), artist_id from artist_aliases
  ) z where k is not null group by k having count(distinct id) = 1
)
insert into track_appearances (track_id, artist_id)
select p.track_id, keys.id
from track_people p join keys on keys.k = p.name_key join tracks t on t.id = p.track_id
where p.role = 'feature' and keys.id <> t.artist_id
on conflict do nothing;

-- ---------- pages ----------
create or replace function rpc_producer(p_name text)
returns table(track_id text, title text, artist_id text, artist text, status text, release_date date, album text, spotify_url text, cover_url text, co_producers text)
language sql stable security definer set search_path to 'public' as $function$
  select t.id, t.title, t.artist_id, a.name,
         coalesce(t.release_status, case when t.is_official then 'released' else 'unconfirmed' end),
         t.release_date, t.album, t.spotify_url, t.cover_url,
         (select string_agg(o.name, ', ') from track_people o where o.track_id = t.id and o.role = 'producer' and o.name_key <> p.name_key)
  from track_people p join tracks t on t.id = p.track_id join artists a on a.id = t.artist_id
  where p.name_key = sc_name_key(p_name) and p.role = 'producer'
  order by t.release_date desc nulls last, a.name, t.title
  limit 1000;
$function$;

-- Features and remixes for the same page.
create or replace function rpc_person_credits(p_name text)
returns jsonb language sql stable security definer set search_path to 'public' as $function$
  select jsonb_build_object(
    'features', coalesce((select jsonb_agg(x order by x.release_date desc nulls last, x.artist, x.title) from (
        select t.id track_id, t.title, t.artist_id, a.name artist,
               coalesce(t.release_status, case when t.is_official then 'released' else 'unconfirmed' end) status,
               t.release_date, t.album, t.spotify_url, t.cover_url, null::text co_producers
        from track_people p join tracks t on t.id = p.track_id join artists a on a.id = t.artist_id
        where p.name_key = sc_name_key(p_name) and p.role = 'feature' limit 1000) x), '[]'::jsonb),
    'remixes', coalesce((select jsonb_agg(x order by x.release_date desc nulls last, x.artist, x.title) from (
        select t.id track_id, t.title, t.artist_id, a.name artist,
               coalesce(t.release_status, case when t.is_official then 'released' else 'unconfirmed' end) status,
               t.release_date, t.album, t.spotify_url, t.cover_url, null::text co_producers
        from track_people p join tracks t on t.id = p.track_id join artists a on a.id = t.artist_id
        where p.name_key = sc_name_key(p_name) and p.role = 'remixer' limit 1000) x), '[]'::jsonb));
$function$;
grant execute on function rpc_person_credits(text) to anon, authenticated;

create or replace function rpc_producers(p_query text default null, p_limit int default 200)
returns table(name text, songs bigint, artists bigint)
language sql stable security definer set search_path to 'public' as $function$
  select mode() within group (order by p.name), count(distinct p.track_id), count(distinct t.artist_id)
  from track_people p join tracks t on t.id = p.track_id
  where p.role = 'producer' and (p_query is null or p.name ilike '%' || p_query || '%')
  group by p.name_key
  order by count(distinct p.track_id) desc, 1
  limit greatest(1, least(coalesce(p_limit, 200), 1000));
$function$;

create or replace function rpc_artist_producer(p_artist_id text)
returns table(name text, songs bigint)
language sql stable security definer set search_path to 'public' as $function$
  with keys as (
    select sc_name_key(a.name) k from artists a where a.id = p_artist_id
    union select sc_name_key(x.alias) from artist_aliases x where x.artist_id = p_artist_id
  )
  select mode() within group (order by p.name), count(distinct p.track_id)
  from track_people p where p.role = 'producer' and p.name_key in (select k from keys where k is not null)
  group by p.name_key
  order by count(distinct p.track_id) desc
  limit 1;
$function$;

-- Song page: everyone credited, with the artist page when there is one.
create or replace function rpc_track_people(p_track text)
returns jsonb language sql stable security definer set search_path to 'public' as $function$
  select coalesce(jsonb_agg(jsonb_build_object('role', p.role, 'name', p.name, 'artist_id', sc_artist_by_name_key(p.name_key))
                            order by p.role, p.name), '[]'::jsonb)
  from track_people p where p.track_id = p_track;
$function$;
grant execute on function rpc_track_people(text) to anon, authenticated;
