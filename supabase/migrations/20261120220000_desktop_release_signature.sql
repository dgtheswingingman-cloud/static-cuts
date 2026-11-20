-- Self-updating desktop app (Nathan, 20 Nov): each published build's updater
-- signature, read by the desktop-update edge function.
alter table public.desktop_releases add column if not exists signature text;
