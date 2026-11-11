-- Control room counts for Duplicates, Deezer check and Clean-up (11 Nov
-- 2026). They're too slow to count on every visit (Clean-up scans every
-- title), so a timer counts them every 15 minutes into home_cache and the
-- control room reads that.
create or replace function sc_refresh_review_counts()
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v jsonb;
begin
  v := jsonb_build_object(
    'duplicates', (
      select count(*) from duplicate_candidates d
      where (select count(*) from tracks t where t.id = any (d.ids)) > 1
        and not exists (select 1 from duplicate_dismissals dd where dd.group_id = d.group_id)
        and not exists (select 1 from duplicate_reports r where r.group_id = d.group_id and r.verdict = 'different'
                        and not exists (select 1 from duplicate_reports r2 where r2.group_id = r.group_id and r2.verdict = 'same'))),
    'deezer_check', (
      select count(*) from artists a
      where (a.deezer_suspect and a.deezer_check is null)
         or (a.deezer_check = 'mixed' and exists (select 1 from deezer_albums d where d.artist_id = a.id and d.review is null))),
    'cleanup', (
      select count(*) from tracks t
      where t.parent_track_id is null and sc_cleanup_kind(t.title) is not null
        and not exists (select 1 from cleanup_kept k where k.track_id = t.id)
        and (sc_cleanup_kind(t.title) = 'not_song'
             or (t.spotify_url is null and t.album is null
                 and not exists (select 1 from tracks v where v.parent_track_id = t.id)
                 and not exists (select 1 from track_ownership o where o.track_id = t.id))))
      + (select count(*) from spotify_link_issues where resolved is null),
    'counted_at', now());
  insert into home_cache (key, data, refreshed_at) values ('review_counts', v, now())
  on conflict (key) do update set data = excluded.data, refreshed_at = excluded.refreshed_at;
  return v;
end $function$;
revoke execute on function sc_refresh_review_counts() from public, anon, authenticated;

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
  ) || coalesce((select data - 'counted_at' from home_cache where key = 'review_counts'), '{}'::jsonb) end;
$function$;

select sc_refresh_review_counts();
select cron.schedule('review-counts', '*/15 * * * *', $$ select public.sc_refresh_review_counts(); $$);
