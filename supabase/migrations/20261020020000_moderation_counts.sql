-- How many things are waiting in each moderation list, for the counts on
-- the Moderation page. Moderators only; takedowns only for the admin.
create or replace function rpc_moderation_counts()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select case when is_moderator() then jsonb_build_object(
    'suggestions', (select count(*) from submissions where status = 'pending'),
    'finds', (select count(*) from discoveries where state = 'open'),
    'sub_versions', (select count(*) from version_suggestions where state = 'open'),
    'imported_songs', (select count(*) from import_suggestions where state = 'open'),
    'guest_artists', (select count(*) from guest_artists where state = 'review' and songs > 0),
    'reported_comments', (select count(distinct c.id) from comments c join comment_reports r on r.comment_id = c.id
                          where c.reviewed_at is null or r.created_at > c.reviewed_at),
    'sheet_requests', (select count(*) from sheet_requests where handled_at is null),
    'takedowns', case when is_admin() then (select count(*) from takedown_requests where state = 'open') end
  ) end;
$$;
revoke execute on function rpc_moderation_counts() from public, anon;
grant execute on function rpc_moderation_counts() to authenticated;

select 'moderation counts ready' as result;
