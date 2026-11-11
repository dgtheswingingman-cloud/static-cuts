-- Album tracklists link to songs added later (11 Nov 2026).
--
-- A tracklist row was only linked to the artist's song when the album was
-- first read; songs added afterwards stayed unlinked (The Money Store linked
-- 6 of 13 although all 13 were on Death Grips' page). Nightly, and now:
--   - same title as exactly one of the artist's main songs -> linked
--   - otherwise, the title without its brackets ("The Fever (Aye Aye)" ->
--     "The Fever") matching exactly one song, unless the brackets say it's a
--     different recording (live, remix, demo, instrumental, session...)
-- Manual tracklist fixes (album_track_overrides) always win.
-- Lookup by title-without-brackets needs its own index (or it times out).
create index if not exists tracks_artist_base_key_idx on tracks (artist_id, (public.sc_title_key(regexp_replace(title, '\s*[\(\[].*$', '')))) where parent_track_id is null;

create or replace function sc_album_link_tracks(p_limit int default 50000)
returns int language plpgsql security definer set search_path to 'public' as $function$
declare n int;
begin
  with u as (
    select at.album_id, at.disk, at.position, at.title, d.artist_id
    from album_tracks at
    join (select distinct album_id, artist_id from deezer_albums where coalesce(review, '') <> 'remove') d on d.album_id = at.album_id
    where at.track_id is null
      and not exists (select 1 from album_track_overrides o where o.album_id = at.album_id and o.disk = coalesce(at.disk, 1) and o.position = at.position)
    limit p_limit
  ),
  m as (
    select u.*,
      (select array_agg(t.id) from tracks t
        where t.artist_id = u.artist_id and t.parent_track_id is null and sc_title_key(t.title) = sc_title_key(u.title)) exact,
      case when u.title ~ '[\(\[]' and u.title !~* '[\(\[][^\)\]]*\m(live|remix|mix|demo|instrumental|acoustic|session|sessions|rehearsal|rehearsals|edit|version|reprise|sped|slowed|a cappella|acapella|interlude|skit|intro|outro)\M'
           and sc_title_key(regexp_replace(u.title, '\s*[\(\[].*$', '')) <> ''
      then (select array_agg(t.id) from tracks t
            where t.artist_id = u.artist_id and t.parent_track_id is null
              and public.sc_title_key(regexp_replace(t.title, '\s*[\(\[].*$', '')) = sc_title_key(regexp_replace(u.title, '\s*[\(\[].*$', ''))) end base
    from u
  ),
  pick as (
    select album_id, disk, position,
           case when cardinality(exact) = 1 then exact[1] when exact is null and cardinality(base) = 1 then base[1] end track_id
    from m
  )
  update album_tracks at set track_id = p.track_id
  from pick p
  where p.track_id is not null and at.album_id = p.album_id and at.position = p.position
    and at.disk is not distinct from p.disk and at.track_id is null;
  get diagnostics n = row_count;
  return n;
end $function$;
revoke execute on function sc_album_link_tracks(int) from public, anon, authenticated;

select sc_album_link_tracks();
select cron.schedule('album-track-linking', '53 3 * * *', $$ select public.sc_album_link_tracks(); $$);

-- Control room: counts for the newer review lists, so empty ones grey out.
create or replace function rpc_moderation_counts()
returns jsonb language sql stable security definer set search_path to 'public' as $function$
  select case when is_moderator() then jsonb_build_object(
    'suggestions', (select count(*) from submissions where status = 'pending'),
    'finds', (select count(*) from discoveries where state = 'open'),
    'sub_versions', (select count(*) from version_suggestions where state = 'open'),
    'imported_songs', (select count(*) from import_suggestions where state = 'open'),
    'guest_artists', (select count(*) from guest_artists where state = 'review' and songs > 0),
    'reported_comments', (select count(distinct c.id) from comments c join comment_reports r on r.comment_id = c.id
                          where c.reviewed_at is null or r.created_at > c.reviewed_at),
    'sheet_requests', (select count(*) from sheet_requests where handled_at is null),
    'tracker_disagreements', (select count(*) from tracker_disagreements where state = 'open'),
    'takedowns', case when is_admin() then (select count(*) from takedown_requests where state = 'open') end,
    'album_fixes', (select count(*) from album_suggestions where status = 'pending'),
    'announcements', (select count(*) from artist_announcements where state = 'open'),
    'wrong_links', (select count(*) from spotify_link_issues where resolved is null)
  ) end;
$function$;
