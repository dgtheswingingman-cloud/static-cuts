-- Premium exports: an artist's full tracklist (every song and version, with
-- status, era, dates, credits, links and Static-Cuts code) for a spreadsheet.
create or replace function rpc_export_artist(p_artist text) returns jsonb
language plpgsql stable security definer set search_path to 'public' set statement_timeout to '30s' as $$
begin
  if auth.uid() is null then raise exception 'Log in first.'; end if;
  if not is_premium(auth.uid()) then raise exception 'Exports are a premium perk.'; end if;
  return coalesce((select jsonb_agg(x order by x.main_title, x.is_version, x.title) from (
    select t.title, p.title version_of, coalesce(p.title, t.title) main_title, t.parent_track_id is not null is_version,
           coalesce(t.release_status, 'unconfirmed') status, nullif(trim(t.album), '') era, t.track_number,
           t.release_date, t.leak_date, t.length_sec, t.producers, t.featured_artists,
           t.spotify_url, t.apple_url, t.deezer_url, c.code, 'https://static-cuts.com/song/' || t.id url
    from tracks t left join tracks p on p.id = t.parent_track_id left join track_codes c on c.track_id = t.id
    where t.artist_id = p_artist limit 20000) x), '[]');
end $$;
revoke execute on function rpc_export_artist(text) from public, anon;
grant execute on function rpc_export_artist(text) to authenticated;
