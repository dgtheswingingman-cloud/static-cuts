-- Deezer check, take two: no guessing. For an artist whose Deezer profile
-- mixes several people, the owner ticks which Deezer releases are theirs.
-- Unticked releases: the songs Deezer added from them go, and they're never
-- added again. Ticked ones that weren't added yet get added. The artist is
-- then "mixed": Deezer keeps reading the profile, but new releases wait on
-- the same list for a tick instead of being added straight away.

alter table deezer_albums add column if not exists review text check (review in ('keep', 'remove'));
alter table artists drop constraint if exists artists_deezer_check_check;
alter table artists add constraint artists_deezer_check_check check (deezer_check in ('ok', 'wrong', 'mixed'));

-- Adding songs: suspect artists only from releases ticked as theirs; mixed
-- artists likewise (new releases wait for a tick).
do $do$
declare d text := pg_get_functiondef('sc_deezer_album_save(text,text,text,jsonb)'::regprocedure);
declare old_line text := 'v_add := not a.catalogue_hold and (not a.deezer_suspect or coalesce(a.deezer_check, '''') = ''ok'');';
begin
  if position('al.review' in d) = 0 then
    if position(old_line in d) = 0 then raise exception 'sc_deezer_album_save: anchor not found'; end if;
    d := replace(d, old_line,
      'v_add := not a.catalogue_hold and coalesce(al.review, '''') <> ''remove'' and (al.review = ''keep'' or ((not a.deezer_suspect or coalesce(a.deezer_check, '''') = ''ok'') and coalesce(a.deezer_check, '''') <> ''mixed''));');
    execute d;
  end if;
end;
$do$;

-- Songs Deezer added from one release (album songs by album name, singles
-- by title).
create or replace function sc_deezer_release_tracks(p_artist text, p_album text)
returns setof text
language sql
stable
security definer
set search_path to 'public'
as $$
  select t.id from tracks t join deezer_albums d on d.artist_id = p_artist and d.album_id = p_album
  where t.artist_id = p_artist and t.source = 'deezer'
    and (t.album = d.title or (t.album is null and sc_title_key(t.title) = sc_title_key(d.title)));
$$;
revoke execute on function sc_deezer_release_tracks(text, text) from public, anon, authenticated;

-- Review list: suspect artists not decided yet, plus mixed artists with new
-- releases waiting for a tick.
drop function if exists admin_deezer_check_list();
create or replace function admin_deezer_check_list()
returns table (artist_id text, name text, deezer_id text, releases int, matched int, known int, deezer_songs int,
               waiting int, mixed boolean, known_sample text[])
language sql
stable
security definer
set search_path to 'public'
as $$
  select a.id, a.name, a.deezer_artist_id, a.deezer_releases, a.deezer_matched,
    (select count(*)::int from tracks t where t.artist_id = a.id and coalesce(t.source, '') <> 'deezer'),
    (select count(*)::int from tracks t where t.artist_id = a.id and t.source = 'deezer'),
    (select count(*)::int from deezer_albums d where d.artist_id = a.id and d.review is null),
    a.deezer_check = 'mixed',
    array(select distinct coalesce(t.album, t.title) from tracks t
          where t.artist_id = a.id and coalesce(t.source, '') <> 'deezer' and coalesce(t.album, t.title) is not null limit 8)
  from artists a
  where is_admin()
    and ((a.deezer_suspect and a.deezer_check is null)
      or (a.deezer_check = 'mixed' and exists (select 1 from deezer_albums d where d.artist_id = a.id and d.review is null)))
  order by a.deezer_check = 'mixed' desc, a.deezer_matched::numeric / greatest(a.deezer_releases, 1), a.deezer_releases desc
  limit 200;
$$;
revoke execute on function admin_deezer_check_list() from public, anon;
grant execute on function admin_deezer_check_list() to authenticated;

-- One artist's Deezer releases, for ticking.
create or replace function admin_deezer_releases(p_artist text)
returns table (album_id text, title text, kind text, year int, link text, review text, songs int, known boolean)
language sql
stable
security definer
set search_path to 'public'
as $$
  with known as (
    select distinct sc_title_key(x) k from tracks t, unnest(array[t.album, t.title]) x
    where t.artist_id = p_artist and coalesce(t.source, '') <> 'deezer' and x is not null)
  select d.album_id, d.title, d.kind, extract(year from d.release_date)::int, d.link, d.review,
    coalesce(d.songs, (select count(*)::int from sc_deezer_release_tracks(p_artist, d.album_id))),
    sc_title_key(d.title) in (select k from known)
  from deezer_albums d
  where is_admin() and d.artist_id = p_artist
  order by d.release_date nulls last, d.title;
$$;
revoke execute on function admin_deezer_releases(text) from public, anon;
grant execute on function admin_deezer_releases(text) to authenticated;

-- Save the ticks: p_keep = theirs, p_remove = someone else's. Removed
-- releases' songs go (undoable); kept ones not added yet are fetched again
-- and added. The artist becomes "mixed" (or "ok" if everything was kept).
create or replace function admin_deezer_pick(p_artist text, p_keep text[], p_remove text[])
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_name text; n int := 0;
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  select name into v_name from artists where id = p_artist;
  if v_name is null then raise exception 'unknown artist'; end if;
  perform set_config('static_cuts.batch_id', '', true);
  perform sc_begin_batch('cleanup', v_name || ': picked which Deezer releases are theirs');
  if coalesce(cardinality(p_remove), 0) > 0 then
    delete from tracks where id in (select sc_deezer_release_tracks(p_artist, r) from unnest(p_remove) r);
    get diagnostics n = row_count;
    update deezer_albums set review = 'remove' where artist_id = p_artist and album_id = any (p_remove);
  end if;
  if coalesce(cardinality(p_keep), 0) > 0 then
    -- Fetched again so any songs that weren't added get added now.
    update deezer_albums set review = 'keep', fetched_at = null, claimed_at = null
    where artist_id = p_artist and album_id = any (p_keep);
  end if;
  update artists set deezer_check = case when coalesce(cardinality(p_remove), 0) > 0 or deezer_check = 'mixed' then 'mixed' else 'ok' end,
                     catalogue_hold = case when deezer_check = 'wrong' then false else catalogue_hold end
  where id = p_artist;
  perform set_config('static_cuts.batch_id', '', true);
  return jsonb_build_object('removed', n);
end;
$$;
revoke execute on function admin_deezer_pick(text, text[], text[]) from public, anon;
grant execute on function admin_deezer_pick(text, text[], text[]) to authenticated;

-- The old all-or-nothing "wrong artist" button is gone.
drop function if exists admin_deezer_check_set(text, text);
create or replace function admin_deezer_check_ok(p_artist text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  update artists set deezer_check = 'ok' where id = p_artist;
end;
$$;
revoke execute on function admin_deezer_check_ok(text) from public, anon;
grant execute on function admin_deezer_check_ok(text) to authenticated;

-- Hi-C: cleaned up by hand; his releases still to be ticked on the list.
update artists set deezer_check = 'mixed', catalogue_hold = false where id = 'hi-c-51dd0b79';
update deezer_albums d set review = 'remove'
where d.artist_id = 'hi-c-51dd0b79'
  and d.title in ('SKANLESS', 'Swing''n', 'The Hi-Life Hustle', 'Body Talk', 'I Dont Know', 'OPEN', 'My Illicit Love Fantasies');
