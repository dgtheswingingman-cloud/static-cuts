-- Nathan, 20 Nov: delete the DONDA and Mixtape Madness artist pages and Ken Carson's
-- placeholder rows. DONDA mixed Kanye's DONDA 2 songs (22 merged into his, CITY OF GOD
-- moved to him, with their collections) and other artists named Donda (55, deleted).
-- Every step is its own undo batch. Already applied.

do $$ declare r record; merged int := 0; left_owned int; begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub','a8deca5e-d808-45dc-a9fc-71d04c8f4226','role','authenticated',
     'email',(select email from auth.users where id='a8deca5e-d808-45dc-a9fc-71d04c8f4226'))::text, true);

  -- 1. DONDA songs that are Kanye's (same title on his page): merged into his.
  for r in
    select d.id dup, (select k.id from tracks k where k.artist_id = 'kanye-west' and k.parent_track_id is null
                      and sc_title_key(k.title) = sc_title_key(d.title)
                      order by release_status_rank(k.release_status) desc, (k.spotify_url is null), k.id limit 1) keep
    from tracks d where d.artist_id = 'donda-7589b3bb' and d.parent_track_id is null
  loop
    continue when r.keep is null;
    perform set_config('static_cuts.batch_id', '', true);
    perform admin_merge_duplicates(r.keep, array[r.dup]);
    merged := merged + 1;
  end loop;

  -- 2. CITY OF GOD (DONDA 2, not on Kanye's page yet): moved to Kanye.
  perform set_config('static_cuts.batch_id', '', true);
  perform sc_begin_batch('cleanup', 'Moved CITY OF GOD (DONDA 2) from the DONDA page to Kanye West');
  update tracks set artist_id = 'kanye-west'
  where artist_id = 'donda-7589b3bb' and (title = 'CITY OF GOD' and album = 'DONDA 2'
     or parent_track_id in (select id from tracks where artist_id = 'donda-7589b3bb' and title = 'CITY OF GOD' and album = 'DONDA 2'));

  select count(*) into left_owned from track_ownership o join tracks t on t.id = o.track_id where t.artist_id = 'donda-7589b3bb';
  if left_owned > 0 then raise exception 'DONDA still has % collected songs; stopping', left_owned; end if;

  -- 3. The two artist pages, then Ken Carson's placeholders.
  perform set_config('static_cuts.batch_id', '', true);
  perform sc_begin_batch('cleanup', 'Deleted the DONDA artist page (other artists named Donda; Kanye''s songs merged first)');
  perform admin_delete_artist('donda-7589b3bb');
  perform set_config('static_cuts.batch_id', '', true);
  perform sc_begin_batch('cleanup', 'Deleted the Mixtape Madness artist page (a channel, not an artist)');
  perform admin_delete_artist('mixtape-madness-eb163d36');
  perform set_config('static_cuts.batch_id', '', true);
  perform sc_begin_batch('cleanup', 'Deleted Ken Carson placeholders "Two Unknown Songs" and "Unknown Songs"');
  perform admin_delete_track('ken-carson-a1a2b65c1f');
  perform admin_delete_track('ken-carson-99c2a6fa68');
end $$;
