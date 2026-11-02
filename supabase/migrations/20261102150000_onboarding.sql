-- New accounts go through a short welcome (pick artists, set up your
-- profile, import your music). Marked done once finished or skipped.
-- Everyone who already has an account counts as done.
alter table profiles add column if not exists onboarded_at timestamptz;
update profiles set onboarded_at = coalesce(onboarded_at, now()) where onboarded_at is null;
