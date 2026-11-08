-- Everything this view reads is already public, so it doesn't need to run
-- with the owner's rights. Same results for everyone. (The rating and
-- completion views stay as they are: averages must count every rating.)
alter view artist_genre_tag_stats set (security_invoker = true);
