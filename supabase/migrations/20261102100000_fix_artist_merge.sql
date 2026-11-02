-- Merging two artists stopped with "duplicate key ... import_suggestions"
-- when both pages had an import suggestion for the same title. Now only
-- suggestions the other page doesn't have move (the rest go with the old
-- page). Also moves the newer things (Deezer/Apple releases, band links) and
-- keeps the Deezer, Apple Music and MusicBrainz profiles.
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

  -- Everything else that belongs to the page (keeping one of each).
  update artist_genre_tags g set artist_id = p_into
  where g.artist_id = p_from and not exists (select 1 from artist_genre_tags h where h.artist_id = p_into and h.tag = g.tag);
  update import_forgotten_titles f set artist_id = p_into
  where f.artist_id = p_from and not exists (select 1 from import_forgotten_titles g where g.artist_id = p_into and g.title_key = f.title_key);
  update import_suggestions s set artist_id = p_into
  where s.artist_id = p_from and not exists (select 1 from import_suggestions o where o.artist_id = p_into and o.title_key = s.title_key);
  update spotify_albums a set artist_id = p_into
  where a.artist_id = p_from and not exists (select 1 from spotify_albums b where b.artist_id = p_into and b.album_id = a.album_id);
  update deezer_albums a set artist_id = p_into
  where a.artist_id = p_from and not exists (select 1 from deezer_albums b where b.artist_id = p_into and b.album_id = a.album_id);
  update apple_albums a set artist_id = p_into
  where a.artist_id = p_from and not exists (select 1 from apple_albums b where b.artist_id = p_into and b.album_id = a.album_id);
  delete from apple_albums where artist_id = p_from;
  update artist_mb_links l set artist_id = p_into
  where l.artist_id = p_from and not exists (select 1 from artist_mb_links m where m.artist_id = p_into and m.other_mbid = l.other_mbid and m.kind = l.kind);
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
  update artists set spotify_artist_id = null, genius_artist_id = null, deezer_artist_id = null,
                     apple_artist_id = null, musicbrainz_id = null
  where id = p_from;
  update artists set
    spotify_artist_id = coalesce(spotify_artist_id, v_from.spotify_artist_id),
    genius_artist_id = coalesce(genius_artist_id, v_from.genius_artist_id),
    deezer_artist_id = coalesce(deezer_artist_id, v_from.deezer_artist_id),
    apple_artist_id = coalesce(apple_artist_id, v_from.apple_artist_id),
    musicbrainz_id = coalesce(musicbrainz_id, v_from.musicbrainz_id),
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
