-- One artist, several profiles (King Krule = also Archy Marshall, Zoo Kid,
-- Edgar the Beatmaker...). The main profile per service stays on artists;
-- extra ones go in artist_profiles with the name they're under. Deezer
-- reads every extra Deezer profile too, so releases under any name land on
-- the one page, and songs released under another name say so (credited_as:
-- "as Archy Marshall"). Merging keeps both pages' profiles.

create table if not exists artist_profiles (
  artist_id text not null references artists(id) on delete cascade,
  service text not null check (service in ('spotify', 'deezer', 'apple', 'genius', 'lastfm')),
  profile_id text not null,
  name text,
  list_index int,
  listed_at timestamptz,
  claim_at timestamptz,
  added_at timestamptz not null default now(),
  primary key (service, profile_id)
);
create index if not exists artist_profiles_artist on artist_profiles (artist_id);
alter table artist_profiles enable row level security;
drop policy if exists "Public can read artist profiles" on artist_profiles;
create policy "Public can read artist profiles" on artist_profiles for select using (true);

alter table tracks add column if not exists credited_as text;

-- Link text -> profile id for each service (null if it doesn't look right).
create or replace function sc_profile_id(p_service text, p_link text)
returns text
language plpgsql
immutable
as $$
declare v text := trim(coalesce(p_link, ''));
begin
  if v = '' then return null; end if;
  if p_service = 'spotify' then
    return coalesce((regexp_match(v, 'artist[/:]([A-Za-z0-9]{22})'))[1], (regexp_match(v, '^([A-Za-z0-9]{22})$'))[1]);
  elsif p_service = 'deezer' then
    return coalesce((regexp_match(v, 'deezer\.com/(?:[a-z]{2}/)?artist/(\d+)'))[1], (regexp_match(v, '^(\d+)$'))[1]);
  elsif p_service = 'apple' then
    return coalesce((regexp_match(v, 'apple\.com/.*artist/(?:[^/?#]+/)?(\d+)'))[1], (regexp_match(v, '^(\d+)$'))[1]);
  elsif p_service = 'genius' then
    if v ~* 'genius\.com/artists/' then
      return 'name:' || replace((regexp_match(v, 'genius\.com/artists/([^/?#]+)', 'i'))[1], '-', ' ');
    end if;
    return v;
  elsif p_service = 'lastfm' then
    if v ~* 'last\.fm/(\w+/)?music/' then
      return replace((regexp_match(v, 'music/([^/?#]+)', 'i'))[1], '+', ' ');
    end if;
    return v;
  end if;
  return null;
end;
$$;

-- Admin: add another profile to an artist (under another name).
create or replace function admin_add_artist_profile(p_artist text, p_service text, p_link text, p_name text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_id text; v_other text; v_name text := nullif(trim(coalesce(p_name, '')), '');
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  if not exists (select 1 from artists where id = p_artist) then raise exception 'unknown artist'; end if;
  if p_service not in ('spotify', 'deezer', 'apple', 'genius', 'lastfm') then raise exception 'unknown service'; end if;
  v_id := sc_profile_id(p_service, p_link);
  if v_id is null then raise exception 'That doesn''t look like a % artist link', p_service; end if;
  select a.name into v_other from artists a
  where (p_service = 'spotify' and a.spotify_artist_id = v_id) or (p_service = 'deezer' and a.deezer_artist_id = v_id)
     or (p_service = 'apple' and a.apple_artist_id = v_id) or (p_service = 'genius' and a.genius_artist_id = v_id)
     or (p_service = 'lastfm' and a.lastfm_name = v_id)
  limit 1;
  if v_other is null then
    select a.name into v_other from artist_profiles p join artists a on a.id = p.artist_id where p.service = p_service and p.profile_id = v_id;
  end if;
  if v_other is not null then raise exception 'That profile is already linked to %', v_other; end if;
  insert into artist_profiles (artist_id, service, profile_id, name) values (p_artist, p_service, v_id, v_name);
  -- The other name counts as theirs (so releases under it are picked up).
  if v_name is not null then
    insert into artist_aliases (alias, alias_key, artist_id) values (v_name, sc_normalize_title(v_name), p_artist)
    on conflict (alias_key) do nothing;
  end if;
  return jsonb_build_object('service', p_service, 'profile_id', v_id, 'name', v_name);
end;
$$;

create or replace function admin_remove_artist_profile(p_artist text, p_service text, p_profile text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  delete from artist_profiles where artist_id = p_artist and service = p_service and profile_id = p_profile;
end;
$$;

revoke execute on function admin_add_artist_profile(text, text, text, text), admin_remove_artist_profile(text, text, text) from public, anon;
grant execute on function admin_add_artist_profile(text, text, text, text), admin_remove_artist_profile(text, text, text) to authenticated;

-- Deezer: a page of an extra profile's releases (they go on the artist's page).
create or replace function sc_deezer_profile_listed(p_secret text, p_deezer_id text, p_albums jsonb, p_next int)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare n int; v_artist text;
begin
  if not sc_deezer_secret_ok(p_secret) then raise exception 'not authorized'; end if;
  select artist_id into v_artist from artist_profiles where service = 'deezer' and profile_id = p_deezer_id;
  if v_artist is null then return 0; end if;
  insert into deezer_albums (artist_id, album_id, kind, title, release_date, cover, link)
  select v_artist, a ->> 'id', a ->> 'kind', left(a ->> 'title', 300),
         case when a ->> 'release_date' ~ '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$' then (a ->> 'release_date')::date end,
         a ->> 'cover', a ->> 'link'
  from jsonb_array_elements(coalesce(p_albums, '[]')) a
  where a ->> 'id' ~ '^\d+$' and a ->> 'kind' in ('album', 'ep', 'single')
  on conflict (artist_id, album_id) do nothing;
  get diagnostics n = row_count;
  update artist_profiles set list_index = p_next, claim_at = null,
                             listed_at = case when p_next is null then now() else listed_at end
  where service = 'deezer' and profile_id = p_deezer_id;
  return n;
end;
$$;
revoke execute on function sc_deezer_profile_listed(text, text, jsonb, int) from public, anon, authenticated;

-- Deezer's picker: extra profiles get their releases listed too (weekly),
-- just before the old-release re-read step.
do $do$
declare d text := pg_get_functiondef('sc_deezer_next(text)'::regprocedure);
declare anchor text := 'select d.artist_id, d.album_id into v_artist, v_album from deezer_albums d';
begin
  if position('artist_profiles' in d) = 0 then
    if position(anchor in d) = 0 then raise exception 'sc_deezer_next: anchor not found'; end if;
    d := replace(d, anchor, $blk$select jsonb_build_object('kind', 'list', 'artist_id', p.artist_id, 'deezer_id', p.profile_id, 'index', coalesce(p.list_index, 0), 'profile', true), p.profile_id
  into v, v_album
  from artist_profiles p
  where p.service = 'deezer' and (p.list_index is not null or p.listed_at is null or p.listed_at < now() - interval '7 days')
    and (p.claim_at is null or p.claim_at < now() - interval '2 minutes')
  order by p.list_index is not null desc, p.listed_at nulls first
  limit 1 for update of p skip locked;
  if v_album is not null then
    update artist_profiles set claim_at = now() where service = 'deezer' and profile_id = v_album;
    return v;
  end if;
  $blk$ || anchor);
    execute d;
  end if;
end;
$do$;

-- New songs from Deezer released under another name say so.
do $do$
declare d text := pg_get_functiondef('sc_deezer_album_save(text,text,text,jsonb)'::regprocedure);
begin
  if position('credited_as' in d) = 0 then
    if position('isrc, explicit, label)' in d) = 0 or position('(it ->> ''explicit'')::boolean, v_label);' in d) = 0 then
      raise exception 'sc_deezer_album_save: anchor not found';
    end if;
    d := replace(d, 'isrc, explicit, label)', 'isrc, explicit, label, credited_as)');
    d := replace(d, '(it ->> ''explicit'')::boolean, v_label);',
      '(it ->> ''explicit'')::boolean, v_label, case when sc_normalize_title(coalesce(it ->> ''artist'', '''')) <> sc_normalize_title(a.name) then nullif(left(it ->> ''artist'', 200), '''') end);');
    execute d;
  end if;
end;
$do$;

-- Song page: which name it came out under.
do $do$
declare d text := pg_get_functiondef('rpc_song_page(text)'::regprocedure);
begin
  if position('credited_as' in d) = 0 then
    if position('''apple_url'', t.apple_url,' in d) = 0 then raise exception 'rpc_song_page: anchor not found'; end if;
    d := replace(d, '''apple_url'', t.apple_url,', '''apple_url'', t.apple_url, ''credited_as'', t.credited_as,');
    execute d;
  end if;
end;
$do$;

-- Everyone: an artist's profiles (main + other names), for buttons.
create or replace function rpc_artist_profiles(p_artist text)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select jsonb_build_object(
    'main', (select jsonb_build_object('spotify', spotify_artist_id, 'deezer', deezer_artist_id, 'apple', apple_artist_id,
                                       'genius', genius_artist_id, 'lastfm', lastfm_name) from artists where id = p_artist),
    'other', coalesce((select jsonb_agg(jsonb_build_object('service', service, 'profile_id', profile_id, 'name', name) order by name, service)
                       from artist_profiles where artist_id = p_artist), '[]'::jsonb));
$$;
grant execute on function rpc_artist_profiles(text) to anon, authenticated;

-- Merge: keeps both pages' profiles. p_alias = "it's another name for
-- them": the moved songs show "as <old name>".
drop function if exists admin_merge_artists(text, text);
create or replace function admin_merge_artists(p_from text, p_into text, p_alias boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_from artists%rowtype;
  v_into artists%rowtype;
  v_songs int;
begin
  if not is_admin() then raise exception 'Only admins can merge artists.'; end if;
  if p_from is null or p_into is null or p_from = p_into then raise exception 'Pick two different artists.'; end if;
  select * into v_from from artists where id = p_from;
  select * into v_into from artists where id = p_into;
  if v_from.id is null or v_into.id is null then raise exception 'Unknown artist.'; end if;
  perform pg_advisory_xact_lock(hashtext('sc_merge_artists'));
  perform sc_begin_batch('merge', 'Merged ' || v_from.name || ' into ' || v_into.name);

  -- Songs and who's on them.
  if p_alias then
    update tracks set credited_as = coalesce(credited_as, v_from.name) where artist_id = p_from;
  end if;
  update tracks set artist_id = p_into where artist_id = p_from;
  get diagnostics v_songs = row_count;
  update track_title_keys set artist_id = p_into where artist_id = p_from;
  update track_appearances a set artist_id = p_into
  where a.artist_id = p_from and not exists (select 1 from track_appearances b where b.track_id = a.track_id and b.artist_id = p_into);
  delete from track_appearances where artist_id = p_from;
  -- No "appears on" for songs that are now on the page itself.
  delete from track_appearances a using tracks t where a.track_id = t.id and a.artist_id = p_into and t.artist_id = p_into;

  -- People: follows and requests (keeping one each).
  update follows f set artist_id = p_into
  where f.artist_id = p_from and not exists (select 1 from follows g where g.user_id = f.user_id and g.artist_id = p_into);
  update artist_requests r set artist_id = p_into
  where r.artist_id = p_from and not exists (select 1 from artist_requests s where s.user_id = r.user_id and s.day = r.day and s.artist_id = p_into);

  -- Everything else that belongs to the page (keeping one of each).
  update artist_genre_tags g set artist_id = p_into
  where g.artist_id = p_from and not exists (select 1 from artist_genre_tags h where h.artist_id = p_into and h.tag = g.tag);
  update import_forgotten_titles f set artist_id = p_into
  where f.artist_id = p_from and not exists (select 1 from import_forgotten_titles g where g.artist_id = p_into and g.title_key = f.title_key);
  update import_suggestions s set artist_id = p_into
  where s.artist_id = p_from and not exists (select 1 from import_suggestions o where o.artist_id = p_into and o.title_key = s.title_key);
  update spotify_albums a set artist_id = p_into
  where a.artist_id = p_from and not exists (select 1 from spotify_albums b where b.artist_id = p_into and b.album_id = a.album_id);
  update deezer_albums a set artist_id = p_into
  where a.artist_id = p_from and not exists (select 1 from deezer_albums b where b.artist_id = p_into and b.album_id = a.album_id);
  update apple_albums a set artist_id = p_into
  where a.artist_id = p_from and not exists (select 1 from apple_albums b where b.artist_id = p_into and b.album_id = a.album_id);
  delete from apple_albums where artist_id = p_from;
  update artist_mb_links l set artist_id = p_into
  where l.artist_id = p_from and not exists (select 1 from artist_mb_links m where m.artist_id = p_into and m.other_mbid = l.other_mbid and m.kind = l.kind);
  update artist_members m set group_id = p_into
  where m.group_id = p_from and m.member_id <> p_into
    and not exists (select 1 from artist_members n where n.group_id = p_into and n.member_id = m.member_id);
  update artist_members m set member_id = p_into
  where m.member_id = p_from and m.group_id <> p_into
    and not exists (select 1 from artist_members n where n.member_id = p_into and n.group_id = m.group_id);
  update submissions set artist_id = p_into where artist_id = p_from;
  update discoveries set artist_id = p_into where artist_id = p_from;
  update discoveries set main_artist_id = p_into where main_artist_id = p_from;
  update takedown_requests set artist_id = p_into where artist_id = p_from;
  update guest_artists set artist_id = p_into where artist_id = p_from;
  update import_runs set artist_id = p_into where artist_id = p_from;
  update sheet_sources set artist_id = p_into where artist_id = p_from;
  update track_link_candidates set artist_id = p_into where artist_id = p_from;
  update admin_actions set artist_id = p_into where artist_id = p_from;
  update spotify_liked_pending set artist_id = p_into where artist_id = p_from;
  delete from artist_track_counts where artist_id = p_from;

  -- Nicknames: the old page's, plus its name.
  update artist_aliases set artist_id = p_into where artist_id = p_from;
  insert into artist_aliases (alias, alias_key, artist_id)
  values (v_from.name, sc_normalize_title(v_from.name), p_into)
  on conflict (alias_key) do nothing;

  -- Profiles: the old page's other profiles move over; its main ones become
  -- the main ones where the page has none, otherwise extra profiles under
  -- the old name (nothing is dropped).
  update artist_profiles set artist_id = p_into where artist_id = p_from;
  insert into artist_profiles (artist_id, service, profile_id, name)
  select p_into, s.service, s.profile_id, v_from.name
  from (values ('spotify', v_from.spotify_artist_id, v_into.spotify_artist_id),
               ('deezer', v_from.deezer_artist_id, v_into.deezer_artist_id),
               ('apple', v_from.apple_artist_id, v_into.apple_artist_id),
               ('genius', v_from.genius_artist_id, v_into.genius_artist_id),
               ('lastfm', v_from.lastfm_name, v_into.lastfm_name)) s(service, profile_id, into_id)
  where s.profile_id is not null and s.into_id is not null and s.profile_id <> s.into_id
  on conflict (service, profile_id) do nothing;
  update artists set spotify_artist_id = null, genius_artist_id = null, deezer_artist_id = null,
                     apple_artist_id = null, musicbrainz_id = null
  where id = p_from;
  update artists set
    spotify_artist_id = coalesce(spotify_artist_id, v_from.spotify_artist_id),
    genius_artist_id = coalesce(genius_artist_id, v_from.genius_artist_id),
    deezer_artist_id = coalesce(deezer_artist_id, v_from.deezer_artist_id),
    apple_artist_id = coalesce(apple_artist_id, v_from.apple_artist_id),
    musicbrainz_id = coalesce(musicbrainz_id, v_from.musicbrainz_id),
    lastfm_name = coalesce(lastfm_name, v_from.lastfm_name),
    image_url = coalesce(image_url, v_from.image_url),
    bio = coalesce(bio, v_from.bio),
    bio_source = case when bio is null then v_from.bio_source else bio_source end,
    bio_source_url = case when bio is null then v_from.bio_source_url else bio_source_url end
  where id = p_into;

  delete from artists where id = p_from;
  perform set_config('static_cuts.batch_id', '', true);
  return jsonb_build_object('songs', v_songs, 'into', p_into);
end;
$$;
revoke execute on function admin_merge_artists(text, text, boolean) from public, anon;
grant execute on function admin_merge_artists(text, text, boolean) to authenticated;

-- Admin: set (or clear, with an empty link) the main Deezer or Apple Music
-- profile. A new Deezer profile is read again from the start.
create or replace function admin_set_artist_main_profile(p_artist text, p_service text, p_link text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_id text; v_other text;
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  if p_service not in ('deezer', 'apple') then raise exception 'unknown service'; end if;
  v_id := sc_profile_id(p_service, p_link);
  if trim(coalesce(p_link, '')) <> '' and v_id is null then raise exception 'That doesn''t look like a % artist link', p_service; end if;
  if v_id is not null then
    select a.name into v_other from artists a
    where a.id <> p_artist and ((p_service = 'deezer' and a.deezer_artist_id = v_id) or (p_service = 'apple' and a.apple_artist_id = v_id));
    if v_other is null then
      select a.name into v_other from artist_profiles p join artists a on a.id = p.artist_id where p.service = p_service and p.profile_id = v_id;
    end if;
    if v_other is not null then raise exception 'That profile is already linked to %', v_other; end if;
  end if;
  if p_service = 'deezer' then
    update artists set deezer_artist_id = v_id, deezer_lookup_at = now(),
      deezer_listed_at = case when deezer_artist_id is distinct from v_id then null else deezer_listed_at end,
      deezer_list_index = case when deezer_artist_id is distinct from v_id then null else deezer_list_index end
    where id = p_artist;
  else
    update artists set apple_artist_id = v_id, apple_checked_at = case when apple_artist_id is distinct from v_id then null else apple_checked_at end
    where id = p_artist;
  end if;
  return jsonb_build_object('service', p_service, 'profile_id', v_id);
end;
$$;
revoke execute on function admin_set_artist_main_profile(text, text, text) from public, anon;
grant execute on function admin_set_artist_main_profile(text, text, text) to authenticated;
