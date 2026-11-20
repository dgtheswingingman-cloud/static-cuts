-- NIX step 5: one song search instead of two.
--
-- cover-search and song-check both looked songs up on Deezer and Apple (link,
-- else exact artist + title search) and both fill covers and mark unconfirmed
-- songs released. In the week to 20 Nov cover-search checked 112,540 songs,
-- 96,042 of them already checked on Deezer by song-check; its Deezer step
-- found 1 cover. Its first pass is finished (1 song left), so from now on it
-- would only repeat song-check's work on new songs.
--
-- So: song-check does it once, with new songs that have no cover first (the
-- ones cover-search used to rush), and cover-search is paused in NIX (Resume
-- on /nix brings it back; nothing is deleted).

do $$
declare d text := pg_get_functiondef('public.sc_song_check_next'::regproc);
declare anchor text := 'order by exists (select 1 from launch_artists l where l.artist_id = t.artist_id) desc,';
begin
  if position('cover_search_checked' in d) > 0 then return; end if;
  if position(anchor in d) = 0 then raise exception 'anchor missing'; end if;
  d := replace(d, anchor, anchor || '
           (t.cover_url is null and t.fan_cover_url is null
            and not exists (select 1 from cover_search_checked cs where cs.track_id = t.id)) desc,');
  execute d;
end $$;

update public.nix_tasks set enabled = false where name = 'cover-search';
