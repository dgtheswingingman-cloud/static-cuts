-- Guest artists: the timer now checks Genius too when none of a guest's songs
-- here are on Spotify (see the guest-artists function). Send the guests that
-- went to review for that reason back through once, so they get the new check.
-- Guests a moderator already skipped, added or linked are left alone.

update guest_artists
set state = 'pending', note = null, checked_at = null, updated_at = now()
where state = 'review'
  and (note = 'On Spotify, but their songs here didn''t match.'
       or note like '% artists on Spotify with this name; none matched their songs.');
