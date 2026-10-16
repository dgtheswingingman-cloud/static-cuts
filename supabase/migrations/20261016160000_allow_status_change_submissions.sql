-- Allow the 'status_change' submission type created by promote_discovery.
alter table public.submissions drop constraint if exists submissions_type_check;
alter table public.submissions add constraint submissions_type_check
  check (type = any (array['new_artist', 'new_track', 'new_version', 'correction', 'flag_link', 'flag_deletion', 'status_change']));
