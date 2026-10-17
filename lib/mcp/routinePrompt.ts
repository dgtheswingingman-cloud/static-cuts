// The scheduled-task prompt users paste into ChatGPT. Kept short: the
// detailed workflow lives in the MCP server's instructions and tool
// descriptions, so it stays in sync with the code.

export const ROUTINE_PROMPT = `Use the Static Cuts connector to help keep my followed artists up to date.

1. Call get_research_plan to get my current followed artists.
2. For each artist (skip any marked researched_recently if you're short on time), search for new music developments since the last check: official releases, features, collaborations, leaks, snippets, teasers, live previews, tracklists, cover art, pre-orders and pre-saves, release-date changes, reissues, archival releases, credible rumors, deleted posts and takedowns. Search official sources first (artist and label accounts, Spotify, Apple Music, YouTube, Bandcamp, stores), then release databases and music press, then community sources (artist subreddits, leak and unreleased trackers, fan archives).
3. Pay special attention to songs in each artist's watch_list: report it when one moves to a new status (rumor, teaser, snippet, leak, announcement, official release, or removed after a takedown).
3b. Each artist also has needs_status: songs whose status is unknown. For each one, find out whether it's released, leaked, a snippet etc., and submit_discovery (with the matching development_type and observed status) for anything you can prove. Then call mark_checked with all of those track_ids, found or not.
4. Features and versions: when an artist guests on someone else's song, pass that song's main artist as main_artist_name (to both check_candidate and submit_discovery) and list any other guests in featured_artists. For demos, alternate versions, remixes, live versions and instrumentals, give the original song title as title and the version as version_hint.
5. Links: for every released song, find its Spotify track link (open.spotify.com/track/...) and pass it as spotify_url. Pass leak or snippet uploads as unofficial_listening_url.
6. For every finding, call check_candidate first. Only call submit_discovery when the verdict is new or known_status_changed, or open_discovery and you have a different source. Never invent sources; one submission per finding with the best source URL. Don't hold back underground finds just because streaming services haven't indexed them yet: submit them as unofficial or unconfirmed with an honest confidence.
7. Clean-up: for each artist you researched, call get_possible_duplicates with its artist_id and look at up to 5 groups. Call report_duplicate with verdict same (only the track_ids that really are one song, e.g. a leak and its official release, or one collab listed on each artist's page) or different (songs that just share a title).
8. Finish with finish_run, listing the artist_ids you researched.
9. Reply with a short summary: what you submitted and which duplicates you reported, grouped by artist.`;
