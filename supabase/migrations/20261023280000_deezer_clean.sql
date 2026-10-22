-- Deezer's clean (edited) album copies and "(Album Version)" labels: the
-- timer now skips clean copies and takes the labels off. This removes the few
-- songs the first run added that way, and lets already-listed clean copies
-- be skipped.
delete from tracks
where source = 'deezer'
  and (title ~* '[\(\[][^\)\]]*\m(edited|clean)\M[^\)\]]*[\)\]]|\s-\s(edited|clean)( version)?$|radio edit'
       or title ~* '[\(\[](album version( explicit)?|explicit( version)?|explicit album version|lp version|main version|(\d{4} )?remaster(ed)?( explicit)?( version)?( \d{4})?)[\)\]]');
update deezer_albums set fetched_at = coalesce(fetched_at, now()) where title ~* '[\(\[][^\)\]]*\m(edited|clean)\M[^\)\]]*[\)\]]';
