-- Merge two artist pages (admins): everything on the first page moves to the
-- second, the first page's name becomes a nickname of the second (so search,
-- imports and guest features find it), and the first page is removed.
-- Songs are moved, not merged: if both pages had the same song, the
-- duplicates page will offer to merge them.

create or replace function admin_merge_artists(p_from text, p_into text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_from artists%rowtype;
  v_into artists%rowtype;
  v_songs int;
begin
  if not is_admin() then raise exception 'Only admins can merge artists.'; end if;
  if p_from is null or p_into is null or p_from = p_into then raise exception 'Pick two different artists.'; end if;
  select * into v_from from artists where id = p_from;
  select * into v_into from artists where id = p_into;
  if v_from.id is null or v_into.id is null then raise exception 'Unknown artist.'; end if;
  perform pg_advisory_xact_lock(hashtext('sc_merge_artists'));
  perform sc_begin_batch('merge', 'Merged ' || v_from.name || ' into ' || v_into.name);

  -- Songs and who's on them.
  update tracks set artist_id = p_into where artist_id = p_from;
  get diagnostics v_songs = row_count;
  update track_title_keys set artist_id = p_into where artist_id = p_from;
  update track_appearances a set artist_id = p_into
  where a.artist_id = p_from and not exists (select 1 from track_appearances b where b.track_id = a.track_id and b.artist_id = p_into);
  delete from track_appearances where artist_id = p_from;
  -- No "appears on" for songs that are now on the page itself.
  delete from track_appearances a using tracks t where a.track_id = t.id and a.artist_id = p_into and t.artist_id = p_into;

  -- People: follows and requests (keeping one each).
  update follows f set artist_id = p_into
  where f.artist_id = p_from and not exists (select 1 from follows g where g.user_id = f.user_id and g.artist_id = p_into);
  update artist_requests r set artist_id = p_into
  where r.artist_id = p_from and not exists (select 1 from artist_requests s where s.user_id = r.user_id and s.day = r.day and s.artist_id = p_into);

  -- Everything else that belongs to the page.
  update artist_genre_tags g set artist_id = p_into
  where g.artist_id = p_from and not exists (select 1 from artist_genre_tags h where h.artist_id = p_into and h.tag = g.tag);
  update import_forgotten_titles f set artist_id = p_into
  where f.artist_id = p_from and not exists (select 1 from import_forgotten_titles g where g.artist_id = p_into and g.title_key = f.title_key);
  update spotify_albums a set artist_id = p_into
  where a.artist_id = p_from and not exists (select 1 from spotify_albums b where b.artist_id = p_into and b.album_id = a.album_id);
  update artist_members m set group_id = p_into
  where m.group_id = p_from and m.member_id <> p_into
    and not exists (select 1 from artist_members n where n.group_id = p_into and n.member_id = m.member_id);
  update artist_members m set member_id = p_into
  where m.member_id = p_from and m.group_id <> p_into
    and not exists (select 1 from artist_members n where n.member_id = p_into and n.group_id = m.group_id);
  update submissions set artist_id = p_into where artist_id = p_from;
  update discoveries set artist_id = p_into where artist_id = p_from;
  update discoveries set main_artist_id = p_into where main_artist_id = p_from;
  update takedown_requests set artist_id = p_into where artist_id = p_from;
  update guest_artists set artist_id = p_into where artist_id = p_from;
  update import_runs set artist_id = p_into where artist_id = p_from;
  update import_suggestions set artist_id = p_into where artist_id = p_from;
  update sheet_sources set artist_id = p_into where artist_id = p_from;
  update track_link_candidates set artist_id = p_into where artist_id = p_from;
  update admin_actions set artist_id = p_into where artist_id = p_from;
  update spotify_liked_pending set artist_id = p_into where artist_id = p_from;
  delete from artist_track_counts where artist_id = p_from;

  -- Nicknames: the old page's, plus its name.
  update artist_aliases set artist_id = p_into where artist_id = p_from;
  insert into artist_aliases (alias, alias_key, artist_id)
  values (v_from.name, sc_normalize_title(v_from.name), p_into)
  on conflict (alias_key) do nothing;

  -- Profiles and photo the second page doesn't have yet.
  update artists set spotify_artist_id = null, genius_artist_id = null where id = p_from;
  update artists set
    spotify_artist_id = coalesce(spotify_artist_id, v_from.spotify_artist_id),
    genius_artist_id = coalesce(genius_artist_id, v_from.genius_artist_id),
    lastfm_name = coalesce(lastfm_name, v_from.lastfm_name),
    image_url = coalesce(image_url, v_from.image_url),
    bio = coalesce(bio, v_from.bio),
    bio_source = case when bio is null then v_from.bio_source else bio_source end,
    bio_source_url = case when bio is null then v_from.bio_source_url else bio_source_url end
  where id = p_into;

  delete from artists where id = p_from;
  perform set_config('static_cuts.batch_id', '', true);
  return jsonb_build_object('songs', v_songs, 'into', p_into);
end;
$$;
revoke execute on function admin_merge_artists(text, text) from public, anon;
grant execute on function admin_merge_artists(text, text) to authenticated;
