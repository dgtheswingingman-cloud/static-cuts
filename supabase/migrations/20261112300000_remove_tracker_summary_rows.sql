-- Tracker counts boxes read as songs ("103 Best Of", "141 Throwaway", "Type",
-- "Categories" under "Total spreadsheet data" / "AVAILABILITY SUMMARY").
-- The reader skips that section now (sheet-import SUMMARY_ERA); this removes
-- the ones already added. Only unowned rows with no versions; undoable.
do $$ begin
  perform sc_begin_batch('tidy', 'Tracker counts rows removed (not songs)');
  delete from tracks t
  where t.source = 'sheet' and t.release_status = 'unconfirmed'
    and t.album ~* 'spreadsheet data|availability summary'
    and not exists (select 1 from track_ownership w where w.track_id = t.id)
    and not exists (select 1 from tracks v where v.parent_track_id = t.id);
  perform set_config('static_cuts.batch_id', '', true);
end $$;
