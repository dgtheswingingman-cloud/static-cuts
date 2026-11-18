-- Run after the Help Wanted admin mode change is live: the old Inbox page
-- (one long list) is gone, so its function is no longer used.
drop function if exists public.rpc_review_inbox(integer);
