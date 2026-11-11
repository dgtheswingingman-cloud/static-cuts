-- Review inbox (11 Nov 2026): everything waiting for a person, on one page,
-- most urgent first (takedowns, reported comments, suggestions and finds,
-- album fixes, shows, sheet requests, tracker disagreements), oldest first
-- within each. Each row opens the list where it's decided. The big lists
-- (versions, duplicates, imports, guests, clean-up) are shown as counts.
create or replace function rpc_review_inbox(p_limit int default 200)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
begin
  if not is_moderator() then raise exception 'not authorized'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(x) order by x.priority, x.at), '[]'::jsonb) from (
    select * from (
      select 1 priority, 'takedown' kind, 'Takedown request' label,
             coalesce((select t.title from tracks t where t.id = r.track_id), r.page_url) title,
             (select a.name from artists a where a.id = r.artist_id) artist, r.created_at at, '/review/takedowns' href
      from takedown_requests r where r.state = 'open' and is_admin()
      union all
      select 2, 'comment', 'Reported comment', left(c.body, 120), null, min(cr.created_at), '/review/comments'
      from comments c join comment_reports cr on cr.comment_id = c.id
      where c.reviewed_at is null or cr.created_at > c.reviewed_at group by c.id, c.body
      union all
      select 3, 'suggestion', initcap(replace(s.type, '_', ' ')),
             coalesce((select t.title from tracks t where t.id = s.payload ->> 'track_id'), s.payload ->> 'title', s.payload ->> 'name'),
             (select a.name from artists a where a.id = s.artist_id), s.created_at, '/review/suggestions'
      from submissions s where s.status = 'pending'
      union all
      select 3, 'find', 'ChatGPT find', d.title || coalesce(' (' || d.version_hint || ')', ''),
             coalesce(d.main_artist_name, (select a.name from artists a where a.id = d.artist_id)), d.first_seen_at, '/review/suggestions'
      from discoveries d where d.state = 'open'
      union all
      select 4, 'album', 'Album fix: ' || replace(s.kind, '_', ' '),
             (select d.title from deezer_albums d where d.album_id = s.album_id limit 1),
             (select a.name from artists a where a.id = s.artist_id), s.created_at, '/review/albums'
      from album_suggestions s where s.status = 'pending'
      union all
      select 4, 'announcement', initcap(n.kind), n.title, (select a.name from artists a where a.id = n.artist_id), n.created_at, '/review/announcements'
      from artist_announcements n where n.state = 'open'
      union all
      select 4, 'sheet', 'Spreadsheet sent in', coalesce(q.artist_name, q.url), null, q.created_at, '/admin/sheets'
      from sheet_requests q where q.handled_at is null
      union all
      select 5, 'tracker', 'Tracker disagrees', coalesce((select t.title from tracks t where t.id = g.track_id), g.tracker_title),
             (select a.name from tracks t join artists a on a.id = t.artist_id where t.id = g.track_id), g.created_at, '/review/tracker'
      from tracker_disagreements g where g.state = 'open'
    ) u
    order by priority, at
    limit greatest(1, least(coalesce(p_limit, 200), 1000))) x);
end $function$;
revoke execute on function rpc_review_inbox(int) from public, anon;
grant execute on function rpc_review_inbox(int) to authenticated;
