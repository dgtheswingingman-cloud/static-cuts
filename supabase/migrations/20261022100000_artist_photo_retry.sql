-- Artist photos: the photo job asked Spotify for several artists at once,
-- which Spotify no longer allows for apps like ours, so no page got a photo.
-- The job now asks one artist at a time (and Genius as a backup). Artists
-- already checked wait 30 days before another try, so let the ones without a
-- photo be tried again now.

update artists set info_checked_at = null where image_url is null;
