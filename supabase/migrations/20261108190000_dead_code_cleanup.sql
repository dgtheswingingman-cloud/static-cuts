-- Dead code sweep (8 Nov 2026). Everything here had no caller left: not the
-- site, not an edge function, not a timer, trigger, policy, view or another
-- database function.

-- "Most wanted" votes: the feature was taken out of the site; 0 votes saved.
do $do$
declare d text; n text;
begin
  d := pg_get_functiondef('rpc_weekly'::regproc);
  n := replace(d, E',\r\n    ''wanted_top'', coalesce((select jsonb_agg(to_jsonb(x)) from rpc_most_wanted(null, 5) x), ''[]''::jsonb));', ');');
  if n = d then n := replace(d, E',\n    ''wanted_top'', coalesce((select jsonb_agg(to_jsonb(x)) from rpc_most_wanted(null, 5) x), ''[]''::jsonb));', ');'); end if;
  if n = d then raise exception 'rpc_weekly patch did not apply'; end if;
  execute n;

  d := pg_get_functiondef('rpc_my_data'::regproc);
  n := regexp_replace(d, E',\\s*''most_wanted_votes'', \\(select coalesce\\(jsonb_agg\\(jsonb_build_object\\(''song_id'', v\\.track_id, ''at'', v\\.created_at\\)\\), ''\\[\\]''\\)\\s*from wanted_votes v where v\\.user_id = auth\\.uid\\(\\)\\)', '');
  if n = d then raise exception 'rpc_my_data patch did not apply'; end if;
  execute n;

  d := pg_get_functiondef('admin_site_stats'::regproc);
  n := regexp_replace(d, E'\\s*union all select user_id, created_at from wanted_votes', '');
  if n = d then raise exception 'admin_site_stats patch did not apply'; end if;
  execute n;
end $do$;
drop function rpc_most_wanted(text, integer);
drop function rpc_toggle_wanted(text);
drop function rpc_wanted_state(text);
drop table wanted_votes;

-- The old home-page leaderboard card (replaced by rpc_top_contributors and its cache).
select cron.unschedule('leaderboard-refresh');
drop function rpc_leaderboard(integer, integer);
drop function sc_refresh_leaderboard();
drop table leaderboard_cache;

-- The song-credits backfill finished (and unscheduled itself).
drop function sc_track_credits_backfill_step(integer);
drop function sc_track_credits_backfill(uuid);
drop table track_credits_backfilled;

-- Callers removed earlier.
drop function rpc_since_last_visit(timestamptz, text[]);
drop function rpc_friends_activity(integer);
drop function rpc_supporters(uuid[]);
drop function rpc_is_trusted(uuid);
drop function rpc_sitemap();
drop function sc_existing_work_left();
drop function sc_guest_wait(text, text, text);
drop function admin_scan_versions(text[]);
drop function admin_spotify_budget();
drop function owner_set_deezer_turbo(boolean);
drop function admin_set_moderator(uuid, boolean, text);

-- Indexes never used since stats began (24 Jul) that only slow down writes.
-- (Unused indexes on foreign keys are kept: deletes need them.)
drop index track_title_keys_key;
drop index tracks_genius_extra_idx;
