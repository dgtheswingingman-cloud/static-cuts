-- Odesli no longer answers sites that aren't allowlisted, so the
-- integration is removed rather than left switched off. Nothing was saved
-- (track_platform_links was empty).
drop function if exists sc_odesli_next(text);
drop function if exists sc_odesli_save(text, text, jsonb);
drop table if exists track_platform_links;
drop index if exists tracks_odesli_pending_idx;
alter table tracks drop column if exists odesli_checked_at, drop column if exists odesli_claim_at;
delete from sc_private_settings where key like 'odesli\_%';
