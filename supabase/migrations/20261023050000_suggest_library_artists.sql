-- Spotify import: artists that aren't in the archive yet are suggested as
-- new artists (the "New Artists" list in the control room), instead of being
-- ignored. Nothing is added until you approve one.
--
-- After an import, Settings sends how many of the listener's songs are by
-- each artist (main artist only). An artist is suggested once their songs
-- across everyone's imports reach 3 (every such artist in the import), and
-- never twice. Approving one makes the page with its Spotify profile
-- already linked, so its songs can be read straight away (unless new
-- artists' catalogues are held: see the control room switch).

create table if not exists spotify_library_artists (
  user_id uuid not null,
  spotify_artist_id text not null,
  name text not null,
  songs int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, spotify_artist_id)
);
alter table spotify_library_artists enable row level security;
revoke all on spotify_library_artists from anon, authenticated;

create table if not exists spotify_artist_suggested (
  spotify_artist_id text primary key,
  submission_id uuid,
  created_at timestamptz not null default now()
);
alter table spotify_artist_suggested enable row level security;
revoke all on spotify_artist_suggested from anon, authenticated;

-- p_artists: [{id, name, songs}] (Spotify artist id, name, how many of the
-- listener's songs are theirs). Returns how many new suggestions were made.
create or replace function rpc_suggest_library_artists(p_artists jsonb)
returns int
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
  where a ->> 'id' ~ '^[A-Za-z0-9]{22}$' and coalesce(btrim(a ->> 'name'), '') <> ''
  on conflict (user_id, spotify_artist_id) do update set name = excluded.name, songs = excluded.songs, updated_at = now();

  for r in
    select l.spotify_artist_id, max(l.name) as name, sum(l.songs) as songs, count(*) as people
    from spotify_library_artists l
    where not exists (select 1 from spotify_artist_suggested s where s.spotify_artist_id = l.spotify_artist_id)
      and not exists (select 1 from artists a where a.spotify_artist_id = l.spotify_artist_id)
    group by l.spotify_artist_id
    having sum(l.songs) >= 3
    order by sum(l.songs) desc
  loop
    -- Already here under that name, or already suggested by someone: skip.
    if exists (select 1 from artists a where sc_normalize_title(a.name) = sc_normalize_title(r.name))
       or exists (select 1 from submissions s where s.type = 'new_artist' and s.status = 'pending'
                  and sc_normalize_title(s.payload ->> 'name') = sc_normalize_title(r.name)) then
      insert into spotify_artist_suggested (spotify_artist_id) values (r.spotify_artist_id) on conflict do nothing;
      continue;
    end if;
    insert into submissions (type, submitted_by, payload)
    values ('new_artist', v_user, jsonb_build_object('name', r.name, 'spotify_artist_id', r.spotify_artist_id,
            'from_spotify', true, 'library_songs', r.songs, 'library_people', r.people))
    returning id into v_sub;
    insert into spotify_artist_suggested (spotify_artist_id, submission_id) values (r.spotify_artist_id, v_sub);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke execute on function rpc_suggest_library_artists(jsonb) from public, anon;
grant execute on function rpc_suggest_library_artists(jsonb) to authenticated;

-- Approving a suggested artist links its Spotify profile to the new page.
create or replace function sc_new_artist_spotify_link()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.type = 'new_artist' and new.status = 'approved' and old.status is distinct from 'approved'
     and new.resulting_id is not null and new.payload ->> 'spotify_artist_id' ~ '^[A-Za-z0-9]{22}$'
     and not exists (select 1 from artists where spotify_artist_id = new.payload ->> 'spotify_artist_id') then
    update artists set spotify_artist_id = new.payload ->> 'spotify_artist_id'
    where id = new.resulting_id and spotify_artist_id is null;
  end if;
  return new;
end;
$$;
drop trigger if exists submissions_new_artist_spotify on submissions;
create trigger submissions_new_artist_spotify after update on submissions
for each row execute function sc_new_artist_spotify_link();
