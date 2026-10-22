-- "Suggest new artists" after an import timed out for big libraries: each
-- artist was checked against every artist and every pending suggestion one
-- at a time. Now the names already here (artists, nicknames, pending
-- suggestions) are gathered once and checked in one go. Nicknames now count
-- as "already here" too.

create or replace function rpc_suggest_library_artists(p_artists jsonb)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user uuid := auth.uid();
  r record;
  v_sub uuid;
  v_n int := 0;
begin
  if v_user is null then raise exception 'Sign in first.'; end if;
  if jsonb_array_length(coalesce(p_artists, '[]')) > 3000 then raise exception 'Too many artists at once.'; end if;

  insert into spotify_library_artists (user_id, spotify_artist_id, name, songs)
  select v_user, a ->> 'id', left(btrim(a ->> 'name'), 200), least(greatest(coalesce((a ->> 'songs')::int, 0), 0), 5000)
  from jsonb_array_elements(coalesce(p_artists, '[]')) a
  where (a ->> 'id' ~ '^[A-Za-z0-9]{22}$' or a ->> 'id' ~ '^name:.+') and coalesce(btrim(a ->> 'name'), '') <> ''
  on conflict (user_id, spotify_artist_id) do update set name = excluded.name, songs = greatest(spotify_library_artists.songs, excluded.songs), updated_at = now();

  -- Names already here or already suggested.
  create temp table if not exists _known (k text primary key) on commit drop;
  truncate _known;
  insert into _known
  select sc_normalize_title(name) from artists
  union select alias_key from artist_aliases where alias_key is not null
  union select sc_normalize_title(payload ->> 'name') from submissions where type = 'new_artist' and status = 'pending'
  on conflict do nothing;

  create temp table if not exists _cand (spotify_artist_id text, name text, songs bigint, people bigint, k text) on commit drop;
  truncate _cand;
  insert into _cand
  select c.*, sc_normalize_title(c.name) from (
    select l.spotify_artist_id, max(l.name) as name, sum(l.songs) as songs, count(*) as people
    from spotify_library_artists l
    where not exists (select 1 from spotify_artist_suggested s where s.spotify_artist_id = l.spotify_artist_id)
      and not exists (select 1 from artists a where a.spotify_artist_id = l.spotify_artist_id)
    group by l.spotify_artist_id
    having sum(l.songs) >= 3) c;

  -- Already here under that name, or already suggested: don't suggest again.
  insert into spotify_artist_suggested (spotify_artist_id)
  select spotify_artist_id from _cand where k is null or k = '' or k in (select k from _known)
  on conflict do nothing;

  -- The rest: one suggestion per name (the ID with the most songs).
  for r in
    select distinct on (c.k) c.* from _cand c
    where coalesce(c.k, '') <> '' and c.k not in (select k from _known)
    order by c.k, c.songs desc
  loop
    insert into submissions (type, submitted_by, payload)
    values ('new_artist', v_user, jsonb_build_object('name', r.name, 'spotify_artist_id', case when r.spotify_artist_id ~ '^[A-Za-z0-9]{22}$' then r.spotify_artist_id end,
            'from_spotify', true, 'library_songs', r.songs, 'library_people', r.people))
    returning id into v_sub;
    insert into spotify_artist_suggested (spotify_artist_id, submission_id)
    select spotify_artist_id, case when spotify_artist_id = r.spotify_artist_id then v_sub end from _cand where k = r.k
    on conflict do nothing;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke execute on function rpc_suggest_library_artists(jsonb) from public, anon;
grant execute on function rpc_suggest_library_artists(jsonb) to authenticated;
