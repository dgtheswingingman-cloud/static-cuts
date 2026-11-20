-- The desktop app's installers (Nathan, 20 Nov): a private storage bucket the
-- Windows build uploads to, and one row per upload. Premium members download
-- through the desktop-download edge function (a 10-minute signed link).
insert into storage.buckets (id, name, public) values ('desktop', 'desktop', false)
on conflict (id) do nothing;

create table if not exists public.desktop_releases (
  id bigint generated always as identity primary key,
  platform text not null default 'windows',
  version text not null,
  path text not null,           -- inside the "desktop" bucket
  size bigint,
  commit_sha text,
  created_at timestamptz not null default now()
);
alter table public.desktop_releases enable row level security;
-- Version and date are public (the /desktop page shows them); the file itself
-- is only reachable through a signed link.
create policy desktop_releases_read on public.desktop_releases for select using (true);
