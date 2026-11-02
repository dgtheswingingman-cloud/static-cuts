-- Applied 2 Nov: sub-version suggestions Claude marked "same song / possible
-- duplicate" (2,679) moved to the "same song" list as merges, so they can be
-- cleared in bulk there.
update version_suggestions set cls = 'dupe', action = 'merge'
where state = 'open' and action = 'link' and parent_track_id is not null and ai_verdict = 'unsure'
  and ai_note ~* '(duplicate|same recording|same song)' and ai_note !~* '(not clearly|not the same|different)';
