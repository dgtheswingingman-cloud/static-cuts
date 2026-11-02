-- Deezer sometimes lumps several artists with the same name into one
-- profile (Hi-C: a 1992 Compton rapper, a Filipino singer and the
-- underground one), and Deezer then added all their songs to our page.
--
-- Each artist's Deezer profile is now compared with the songs we already
-- know for them (from Spotify, Genius, sheets...): how many of its releases
-- match. Profiles that match almost nothing go on a review list
-- (/review/deezer) and Deezer stops adding new songs to them until the
-- owner says "looks right". "Wrong artist" removes the songs Deezer added
-- (keeping ones on albums we know are theirs and ones on their own Spotify)
-- and stops Deezer adding more.
-- Both can be undone from the undo history.

alter table artists
  add column if not exists deezer_releases int,
  add column if not exists deezer_matched int,
  add column if not exists deezer_match_at timestamptz,
  add column if not exists deezer_suspect boolean not null default false,
  add column if not exists deezer_check text check (deezer_check in ('ok', 'wrong'));

-- How many of the artist's Deezer releases match songs/albums we already
-- know for them (not from Deezer). Suspect: 10+ releases, 10+ songs known
-- from elsewhere, and (almost) none of the releases match.
create or replace function sc_deezer_match_check(p_artist text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_rel int; v_match int; v_other int;
begin
  with known as (
    select distinct sc_title_key(x) k from tracks t, unnest(array[t.album, t.title]) x
    where t.artist_id = p_artist and coalesce(t.source, '') <> 'deezer' and x is not null)
  select count(*), count(*) filter (where sc_title_key(d.title) in (select k from known))
  into v_rel, v_match
  from deezer_albums d where d.artist_id = p_artist;
  select count(*) into v_other from tracks where artist_id = p_artist and coalesce(source, '') <> 'deezer';
  update artists set deezer_releases = v_rel, deezer_matched = v_match, deezer_match_at = now(),
    deezer_suspect = v_rel >= 10 and v_other >= 10 and v_match <= greatest(1, floor(0.03 * v_rel))
  where id = p_artist;
end;
$$;
revoke execute on function sc_deezer_match_check(text) from public, anon, authenticated;

-- Checked whenever Deezer finishes listing an artist's releases.
do $do$
declare d text := pg_get_functiondef('sc_deezer_listed(text,text,jsonb,integer)'::regprocedure);
begin
  if position('sc_deezer_match_check' in d) = 0 then
    if position('  return n;' in d) = 0 then raise exception 'sc_deezer_listed: anchor not found'; end if;
    d := replace(d, '  return n;', '  if p_next is null then perform sc_deezer_match_check(p_artist); end if;
  return n;');
    execute d;
  end if;
end;
$do$;

-- Deezer doesn't add new songs to suspect artists until "looks right".
do $do$
declare d text := pg_get_functiondef('sc_deezer_album_save(text,text,text,jsonb)'::regprocedure);
begin
  if position('deezer_suspect' in d) = 0 then
    if position('v_add := not a.catalogue_hold;' in d) = 0 then raise exception 'sc_deezer_album_save: anchor not found'; end if;
    d := replace(d, 'v_add := not a.catalogue_hold;',
      'v_add := not a.catalogue_hold and (not a.deezer_suspect or coalesce(a.deezer_check, '''') = ''ok'');');
    execute d;
  end if;
end;
$do$;

-- Review list: suspect artists not decided yet, worst first.
create or replace function admin_deezer_check_list()
returns table (artist_id text, name text, deezer_id text, releases int, matched int, known int, deezer_songs int,
               deezer_sample text[], known_sample text[])
language sql
stable
security definer
set search_path to 'public'
as $$
  select a.id, a.name, a.deezer_artist_id, a.deezer_releases, a.deezer_matched,
    (select count(*)::int from tracks t where t.artist_id = a.id and coalesce(t.source, '') <> 'deezer'),
    (select count(*)::int from tracks t where t.artist_id = a.id and t.source = 'deezer'),
    array(select d.title || coalesce(' (' || extract(year from d.release_date)::int || ')', '') from deezer_albums d
          where d.artist_id = a.id order by d.release_date nulls last limit 6),
    array(select distinct coalesce(t.album, t.title) from tracks t
          where t.artist_id = a.id and coalesce(t.source, '') <> 'deezer' and coalesce(t.album, t.title) is not null limit 6)
  from artists a
  where is_admin() and a.deezer_suspect and a.deezer_check is null
  order by a.deezer_matched::numeric / greatest(a.deezer_releases, 1), a.deezer_releases desc
  limit 200;
$$;
revoke execute on function admin_deezer_check_list() from public, anon;
grant execute on function admin_deezer_check_list() to authenticated;

-- "ok": Deezer carries on as normal. "wrong": the songs Deezer added go,
-- except ones on albums known from elsewhere and ones found on the
-- artist's own Spotify (singles included), and Deezer adds no more.
create or replace function admin_deezer_check_set(p_artist text, p_verdict text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_name text; n int := 0;
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  if p_verdict not in ('ok', 'wrong') then raise exception 'unknown verdict'; end if;
  select name into v_name from artists where id = p_artist;
  if v_name is null then raise exception 'unknown artist'; end if;
  if p_verdict = 'ok' then
    update artists set deezer_check = 'ok' where id = p_artist;
    return jsonb_build_object('removed', 0);
  end if;
  perform set_config('static_cuts.batch_id', '', true);
  perform sc_begin_batch('cleanup', v_name || ': removed songs Deezer added from another artist with the same name');
  delete from tracks t
  where t.artist_id = p_artist and t.source = 'deezer'
    and t.spotify_url is null
    and coalesce(t.album, '') not in (
      select coalesce(o.album, '') from tracks o
      where o.artist_id = p_artist and coalesce(o.source, '') <> 'deezer' and o.album is not null);
  get diagnostics n = row_count;
  update artists set deezer_check = 'wrong', catalogue_hold = true where id = p_artist;
  perform set_config('static_cuts.batch_id', '', true);
  return jsonb_build_object('removed', n);
end;
$$;
revoke execute on function admin_deezer_check_set(text, text) from public, anon;
grant execute on function admin_deezer_check_set(text, text) to authenticated;

-- Mark the suspects from the check already run on every artist.
update artists a set deezer_suspect = true
from (select artist_id, count(*) c from tracks where coalesce(source, '') <> 'deezer' group by artist_id) o
where o.artist_id = a.id and a.deezer_releases >= 10 and o.c >= 10
  and a.deezer_matched <= greatest(1, floor(0.03 * a.deezer_releases));

-- Hi-C was cleaned up by hand already.
update artists set deezer_check = 'wrong' where id = 'hi-c-51dd0b79';
