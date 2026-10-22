-- Spotify, done more efficiently.
--
-- Before: one Spotify search per song (about 94,000 songs waiting, at 25
-- calls an hour), plus searches for songs that can't be on Spotify (leaks,
-- snippets, rumours).
--
-- Now: for artists we have a Spotify profile for, match-spotify reads their
-- releases instead. One call lists up to 50 releases; one call per release
-- returns every song on it. Each song on a release is matched to the
-- archive by title, so one call can cover a dozen songs. Each release's
-- songs are kept, so a later "import from Spotify" on the artist page can
-- add them straight away without asking Spotify again. Links seen on a
-- release also count as checked, so the link checker can skip them.
--
-- Per-song search is still used for artists with no Spotify profile, and
-- only for songs that might be out (not leaked, snippet, announced,
-- rumoured or teased).

create table if not exists spotify_albums (
  artist_id text not null references artists(id) on delete cascade,
  album_id text not null,
  grp text not null check (grp in ('album', 'single', 'appears_on')),
  name text,
  items jsonb,            -- this artist's songs on the release, once fetched
  listed_at timestamptz not null default now(),
  fetched_at timestamptz,
  primary key (artist_id, album_id)
);
create index if not exists spotify_albums_todo on spotify_albums (artist_id) where fetched_at is null;
alter table spotify_albums enable row level security;
revoke all on spotify_albums from anon, authenticated;

-- Where the listing of an artist's releases got to (offset), and when it
-- last finished. Releases are re-listed monthly to catch new ones.
alter table artists add column if not exists spotify_albums_offset int;
alter table artists add column if not exists spotify_albums_listed_at timestamptz;

create index if not exists tracks_spotify_url_idx on tracks (spotify_url) where spotify_url is not null;

-- The next piece of release work: list an artist's releases, or fetch one
-- release. Artists someone pressed "import from Spotify" for go first, then
-- followed or requested artists, then the rest, finishing one artist before
-- starting the next.
create or replace function sc_spotify_album_next()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  with cand as (
    select a.id, a.spotify_artist_id, a.spotify_albums_offset,
           (a.spotify_albums_offset is not null or a.spotify_albums_listed_at is null
            or a.spotify_albums_listed_at < now() - interval '30 days') as list_due,
           exists (select 1 from spotify_albums s where s.artist_id = a.id and s.fetched_at is null) as has_albums,
           exists (select 1 from import_runs r where r.artist_id = a.id and r.source = 'spotify'
                   and r.finished_at is null) as requested
    from artists a
    where a.spotify_artist_id ~ '^[A-Za-z0-9]{22}$'
  ), pick as (
    select c.* from cand c left join sc_artist_weights() w on w.artist_id = c.id
    where c.list_due or c.has_albums
    order by c.requested desc, (coalesce(w.weight, 0) > 0) desc,
             (c.spotify_albums_offset is not null or c.has_albums) desc,
             coalesce(w.weight, 0) desc, c.id
    limit 1
  )
  select case
    when p.id is null then null
    when p.list_due then jsonb_build_object('kind', 'list', 'artist_id', p.id, 'spotify_artist_id', p.spotify_artist_id,
                                            'offset', coalesce(p.spotify_albums_offset, 0))
    else (select jsonb_build_object('kind', 'album', 'artist_id', p.id, 'spotify_artist_id', p.spotify_artist_id,
                                    'album_id', s.album_id)
          from spotify_albums s where s.artist_id = p.id and s.fetched_at is null
          order by case s.grp when 'album' then 0 when 'single' then 1 else 2 end, s.album_id limit 1)
  end
  from (select 1) one left join pick p on true;
$$;
revoke execute on function sc_spotify_album_next() from public, anon, authenticated;

-- When an artist's releases are all read and someone asked for an import,
-- add the songs (sc_import_add_tracks skips anything already on the page)
-- and close the import.
create or replace function sc_spotify_album_try_finish(p_artist text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_run uuid;
  v_items jsonb;
  v_res jsonb;
begin
  if exists (select 1 from artists where id = p_artist
             and (spotify_albums_offset is not null or spotify_albums_listed_at is null))
     or exists (select 1 from spotify_albums where artist_id = p_artist and fetched_at is null) then
    return null;
  end if;
  select id into v_run from import_runs where artist_id = p_artist and source = 'spotify' and finished_at is null
  order by started_at desc limit 1;
  if v_run is null then return null; end if;
  -- Albums first, so songs keep their album's name rather than a single's.
  select coalesce(jsonb_agg(it order by case s.grp when 'album' then 0 when 'single' then 1 else 2 end, s.album_id), '[]')
  into v_items
  from spotify_albums s, jsonb_array_elements(coalesce(s.items, '[]')) it
  where s.artist_id = p_artist;
  v_res := sc_import_add_tracks(v_run, v_items);
  update import_runs set finished_at = now() where artist_id = p_artist and source = 'spotify' and finished_at is null;
  return v_res;
end;
$$;
revoke execute on function sc_spotify_album_try_finish(text) from public, anon, authenticated;

-- One page of an artist's releases: [{album_id, grp, name}], and the next
-- offset (null when that was the last page).
create or replace function sc_spotify_album_listed(p_artist text, p_albums jsonb, p_next int)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into spotify_albums (artist_id, album_id, grp, name)
  select p_artist, a ->> 'album_id', a ->> 'grp', a ->> 'name'
  from jsonb_array_elements(coalesce(p_albums, '[]')) a
  where a ->> 'album_id' ~ '^[A-Za-z0-9]{22}$' and a ->> 'grp' in ('album', 'single', 'appears_on')
  on conflict do nothing;
  update artists set spotify_albums_offset = p_next,
                     spotify_albums_listed_at = case when p_next is null then now() else spotify_albums_listed_at end
  where id = p_artist;
  return sc_spotify_album_try_finish(p_artist);
end;
$$;
revoke execute on function sc_spotify_album_listed(text, jsonb, int) from public, anon, authenticated;

-- One release's songs (same shape sc_import_add_tracks takes). Links
-- already in the archive are marked as checked; songs without a link that
-- have exactly the same title by this artist get it. Matches go in the
-- "Spotify matching" undo batch like the per-song search.
create or replace function sc_spotify_album_save(p_artist text, p_album_id text, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_verified int;
  v_matched int;
begin
  update tracks set spotify_link_verified_at = now()
  where spotify_url in (select it ->> 'spotify_url' from jsonb_array_elements(coalesce(p_items, '[]')) it);
  get diagnostics v_verified = row_count;

  perform set_config('static_cuts.batch_id', sc_job_batch('spotify_match', 'Spotify matching')::text, true);
  with it as (
    select sc_title_key(i ->> 'title') k, i ->> 'spotify_url' url, nullif(i ->> 'album', '') album,
           case when i ->> 'release_date' ~ '^\d{4}-\d{2}-\d{2}$' then (i ->> 'release_date')::date end rd, n
    from jsonb_array_elements(coalesce(p_items, '[]')) with ordinality x(i, n)
    where i ->> 'spotify_url' like 'https://open.spotify.com/track/%'
      and not exists (select 1 from tracks x where x.spotify_url = i ->> 'spotify_url')
  ), mine as (
    select t.id, t.title from tracks t where t.artist_id = p_artist and t.spotify_url is null and t.parent_track_id is null
    union
    select t.id, t.title from track_appearances ap join tracks t on t.id = ap.track_id
    where ap.artist_id = p_artist and t.spotify_url is null and t.parent_track_id is null
  ), m as (
    select distinct on (mine.id) mine.id, it.url, it.album, it.rd
    from mine join it on it.k = sc_title_key(mine.title)
    where it.k <> ''
    order by mine.id, it.n
  )
  update tracks t set
    spotify_url = m.url,
    release_status = case when t.release_status = 'removed' then t.release_status else 'released' end,
    album = coalesce(t.album, m.album),
    release_date = coalesce(t.release_date, m.rd),
    spotify_search_attempted_at = now(),
    spotify_link_verified_at = now()
  from m where t.id = m.id;
  get diagnostics v_matched = row_count;
  perform set_config('static_cuts.batch_id', '', true);

  update spotify_albums set items = coalesce(p_items, '[]'), fetched_at = now()
  where artist_id = p_artist and album_id = p_album_id;
  return jsonb_build_object('matched', v_matched, 'verified', v_verified,
                            'import', sc_spotify_album_try_finish(p_artist));
end;
$$;
revoke execute on function sc_spotify_album_save(text, text, jsonb) from public, anon, authenticated;

-- "Import from Spotify" on an artist page. If the artist's releases were
-- all read in the last day, the songs are added now with no calls to Spotify.
-- Otherwise the import stays open and match-spotify finishes it.
create or replace function sc_spotify_import_request(p_run uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_artist text;
  v_res jsonb;
begin
  select artist_id into v_artist from import_runs where id = p_run and finished_at is null;
  if v_artist is null then raise exception 'import run not active'; end if;
  -- Releases last read more than a day ago: look for new ones first (only
  -- new releases are read again).
  update artists set spotify_albums_offset = 0
  where id = v_artist and spotify_albums_offset is null
    and spotify_albums_listed_at < now() - interval '1 day';
  v_res := sc_spotify_album_try_finish(v_artist);
  if v_res is not null then
    return v_res || jsonb_build_object('done', true);
  end if;
  return jsonb_build_object('done', false,
    'releases_left', (select count(*) from spotify_albums where artist_id = v_artist and fetched_at is null),
    'listed', (select spotify_albums_listed_at is not null and spotify_albums_offset is null from artists where id = v_artist));
end;
$$;
revoke execute on function sc_spotify_import_request(uuid) from public, anon, authenticated;

-- Per-song search: only for artists with no Spotify profile (the rest are
-- covered by their releases), and only for songs that might be out.
create or replace function sc_spotify_match_next(p_limit integer default 10)
returns table(id text, title text, release_status text, album text, release_date date, artist text, others text[])
language sql
stable
security definer
set search_path to 'public'
as $$
  with todo as (
    select t.id, t.title, t.release_status, t.album, t.release_date, t.artist_id,
           row_number() over (partition by t.artist_id order by (t.parent_track_id is null) desc, t.id) turn
    from tracks t
    join artists a0 on a0.id = t.artist_id
    where t.spotify_url is null and t.spotify_search_attempted_at is null
      and coalesce(t.release_status, '') not in ('leaked', 'snippet', 'announced', 'rumored', 'teased')
      and coalesce(a0.spotify_artist_id, '') !~ '^[A-Za-z0-9]{22}$'
  )
  select d.id, d.title, d.release_status, d.album, d.release_date, a.name,
         array(select a2.name from track_appearances ap join artists a2 on a2.id = ap.artist_id where ap.track_id = d.id)
  from todo d
  join artists a on a.id = d.artist_id
  left join sc_artist_weights() w on w.artist_id = d.artist_id
  order by (coalesce(w.weight, 0) > 0) desc, d.turn, coalesce(w.weight, 0) desc, d.artist_id
  limit greatest(1, least(coalesce(p_limit, 10), 50));
$$;
