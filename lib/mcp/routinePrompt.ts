// The scheduled-task prompt users paste into ChatGPT. Kept short: the
// detailed rules live in the MCP server's instructions and tool
// descriptions, so they stay in sync with the code.

export const ROUTINE_PROMPT = `Use the Static-Cuts connector to keep my followed artists up to date. Work in two parts, A then B, and stop when you run out of time.

A. NEWS (only artists that are due)
1. Call get_review_status once: never resend anything it shows as rejected or dismissed.
2. Call get_research_plan. For each artist with due = true, search for news dated on or after search_since (empty = full sweep): releases, features, leaks, snippets, teasers, tracklists, release-date changes, takedowns, credible rumours. Official sources first, then release databases and press, then community sources (subreddits, trackers). Skip anything already in recently_added, already_handled or open_discoveries.
3. Watch-list songs: report when one changes status. needs_status songs: find out what they are.
4. Check all of an artist's finds in one check_candidates call, then submit_discovery only for verdict new or known_status_changed (or open_discovery with a different source). Versions: original title as title, the version as version_hint. Features on someone else's song: their name as main_artist_name. Released songs: include the Spotify track link.
5. Shows, tours, festival slots and merch drops you come across: submit_announcement (one per tour).
6. finish_run with every artist_id you researched, even with nothing new.

B. CATALOGUE (whenever A has nothing due, or you have time left)
7. Call get_catalogue_backlog. For each song: needs status -> submit_discovery what you can prove; needs link -> suggest_link; needs details -> suggest_details with the page that shows them; needs cover -> suggest_cover with the picture's direct link and the page it's on (only art really used for that song). Wrong filled-in detail -> suggest_details with replace = true and why in notes. recheck items -> only resubmit with new evidence.
8. mark_checked with every track_id (and recheck discovery_id) you looked at, found or not, then call get_catalogue_backlog again for the next page.
9. For artists you worked on, look at up to 5 groups from get_possible_duplicates and report_duplicate same or different.

Rules: never invent sources; one submission per finding with its best source page; never download or link audio files. Underground finds are welcome as unofficial or unconfirmed with an honest confidence.

Reply with a short summary grouped by artist: what you submitted, links and details suggested, shows found, duplicates reported.`;
