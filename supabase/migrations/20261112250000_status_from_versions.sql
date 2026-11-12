-- An unconfirmed song whose versions already say what happened takes that
-- status: leaked > snippet > announced > teased > rumored (the furthest a
-- version got). Only when nothing official exists for it: no released
-- version, no Spotify/Deezer/Apple link, and the Deezer check found nothing.
-- Released versions don't count (they're often live versions or remixes of
-- a song whose own status we don't know). Quiet, undoable, hourly.
create or replace function sc_status_from_versions() returns jsonb
language plpgsql security definer set search_path to 'public' set statement_timeout to '60s' as $$
declare v_n int := 0; v_ids text[]; v_sts text[];
begin
  select array_agg(r.id), array_agg(r.st) into v_ids, v_sts from (
    select t.id,
      (select v.release_status from tracks v where v.parent_track_id = t.id and v.release_status in ('leaked', 'snippet', 'announced', 'teased', 'rumored')
       order by array_position(array['leaked', 'snippet', 'announced', 'teased', 'rumored'], v.release_status) limit 1) st
    from tracks t
    where t.parent_track_id is null and t.release_status = 'unconfirmed'
      and (t.spotify_url is null or t.spotify_url !~* 'open\.spotify\.com') and t.deezer_url is null and t.apple_url is null
      and exists (select 1 from song_checks c where c.track_id = t.id and c.service = 'deezer' and c.found = 'none')
      and not exists (select 1 from tracks v where v.parent_track_id = t.id and v.release_status = 'released')) r
  where r.st is not null;
  if v_ids is null then return jsonb_build_object('updated', 0); end if;
  perform sc_begin_batch('status', 'Status from versions');
  perform set_config('static_cuts.skip_status_log', 'on', true);
  update tracks t set release_status = x.st from unnest(v_ids, v_sts) x(id, st) where t.id = x.id and t.release_status = 'unconfirmed';
  get diagnostics v_n = row_count;
  perform set_config('static_cuts.skip_status_log', '', true);
  perform set_config('static_cuts.batch_id', '', true);
  return jsonb_build_object('updated', v_n);
end $$;
revoke execute on function sc_status_from_versions() from public, anon, authenticated;

select cron.schedule('status-from-versions', '17 * * * *', $c$select public.sc_status_from_versions()$c$);
