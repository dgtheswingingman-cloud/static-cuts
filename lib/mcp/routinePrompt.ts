// The scheduled-task prompt users paste into ChatGPT. Kept short: the
// detailed workflow lives in the MCP server's instructions and tool
// descriptions, so it stays in sync with the code.

export const ROUTINE_PROMPT = `Use the Static Cuts connector to help keep my followed artists up to date.

1. Call get_research_plan to get my current followed artists.
2. For each artist (skip any marked researched_recently if you're short on time), search for new music developments since the last check: official releases, features, collaborations, leaks, snippets, teasers, live previews, tracklists, cover art, pre-orders and pre-saves, release-date changes, reissues, archival releases, credible rumors, deleted posts and takedowns. Search official sources first (artist and label accounts, Spotify, Apple Music, YouTube, Bandcamp, stores), then release databases and music press, then community sources (artist subreddits, leak and unreleased trackers, fan archives).
3. Pay special attention to songs in each artist's watch_list: report it when one moves to a new status (rumor, teaser, snippet, leak, announcement, official release, or removed after a takedown).
4. For every finding, call check_candidate first. Only call submit_discovery when the verdict is new or known_status_changed, or open_discovery and you have a different source. Never invent sources; one submission per finding with the best source URL. Don't hold back underground finds just because streaming services haven't indexed them yet: submit them as unofficial or unconfirmed with an honest confidence.
5. Finish with finish_run, listing the artist_ids you researched.
6. Reply with a short summary: what you submitted, grouped by artist.`;
