# ChatGPT routines

Lets users connect ChatGPT to Static Cuts and run a scheduled task that checks
the artists they follow for new songs and status changes. Findings land in a
"Routine discoveries" list on `/review`; nothing changes on the site until an
admin promotes a finding and then approves the resulting submission.

## How it fits together

```
ChatGPT scheduled task
  -> /api/mcp  (MCP server, 5 tools, OAuth bearer token)
       -> Postgres functions run as the user
            rpc_research_plan / rpc_check_candidate / rpc_submit_discovery / rpc_finish_run
            -> discoveries + discovery_evidence  (merged by fingerprint)
/review  -> Routine discoveries -> promote_discovery -> submissions (normal queue)
         -> approve_submission / approve_status_change -> tracks
```

- `tracks.release_status` (rumored, teased, snippet, leaked, announced,
  released, removed) is new. It's kept in sync with `is_official` by a trigger,
  so existing code keeps working. Every change is logged in
  `track_status_events`.
- OAuth tokens carry a `client_id` claim. `is_admin()` now returns false for
  them, and restrictive RLS policies stop them writing to any table directly.
  A connected app can only call the routine functions.
- 100 routines reporting the same thing produce one discovery with up to 100
  distinct sources, and one review card.

## One-time setup

### 1. Run the database migration

Supabase dashboard -> SQL Editor -> New query -> paste the whole of
`supabase/migrations/20261016150000_chatgpt_discoveries.sql` -> Run.

It's additive and wrapped in a transaction: if anything fails, nothing is
applied.

### 2. Turn on Supabase's OAuth server

Supabase dashboard -> Authentication -> OAuth Server:

- Enable the OAuth 2.1 server.
- Authorization Path: `/oauth/consent`
- Allow dynamic client registration: on (ChatGPT registers itself).

Authentication -> URL Configuration: make sure Site URL is
`https://static-cuts.com`.

If ChatGPT's sign-in fails with an ID token error, switch the project's JWT
signing key to an asymmetric key (RS256/ES256) under Project Settings -> JWT
Keys; Supabase can't issue OpenID ID tokens with the legacy HS256 secret.

### 3. Optional environment variable

`NEXT_PUBLIC_SITE_URL=https://static-cuts.com` on Vercel (Production). Without
it the server uses the request's own address, which is fine.

## Connecting ChatGPT (each user)

Shown on `/settings` too.

1. ChatGPT -> Settings -> Apps & Connectors -> Advanced -> enable developer
   mode, then Create a connector with URL `https://static-cuts.com/api/mcp`,
   authentication OAuth.
2. Sign in to Static Cuts on the page that opens and press Allow.
3. In a chat: "use Static Cuts test_connection". A test run then shows on
   `/settings`.
4. Create a scheduled task with the instructions from the "copy instructions"
   button on `/settings` (source: `lib/mcp/routinePrompt.ts`).

## Check before relying on it

- Step 3 above proves a write works from a normal chat. The open question is
  whether scheduled (unattended) runs can call custom connector tools without
  asking for confirmation. Schedule a task that only calls `test_connection`,
  wait for it to fire, and check `/settings` shows the run.
- ChatGPT plan limits on scheduled tasks and custom connectors change; check
  OpenAI's current help pages.

## Not built yet

Automatic promotion rules, skipping artists for everyone once enough routines
have checked them, trust scores, contributor credits, notification settings,
and a backend fallback for artists no routine covers.

## Links and duplicate cleanup

Added in `20261016180000_links_and_duplicates.sql`.

- Titles match ignoring spaces as well as case and punctuation, so
  "GLOOM ROOM" and "GLOOMROOM" are the same song.
- A collab already on a collaborator's page is matched and linked instead of
  being added again.
- Approved discoveries get a listen link: the Spotify track link if the
  routine found one, otherwise the best official link (Apple Music, YouTube,
  Bandcamp). Leak uploads become link suggestions on the artist page.
- `/review/duplicates` lists likely duplicates: the same title twice on one
  artist's page, or on two artists who share at least 5 titles and 10% of the
  smaller catalogue (or are already linked). Generic titles like Intro or
  Untitled are left out. Routines judge groups with `report_duplicate`;
  "different" verdicts hide a group, "same" verdicts sort it to the top.
- Merging (`admin_merge_duplicates`) moves collections, ratings, comments,
  sub-versions and link suggestions to the kept track, keeps the furthest
  release status and any missing details, links the other artists, then uses
  `admin_merge_track` so the old titles become aliases and the old pages
  redirect.

## Status, link suggestions and clean-up tools

Added in `20261017190000_status_links_cleanup.sql`.

- **Unconfirmed** is the starting status for songs with no evidence. Songs that
  were only "leaked" because the old data had no status became unconfirmed;
  titles with "(Demo)", "(Reference)", "[V2]" etc. became leaked and
  "(Snippet)"/"(Preview)" became snippet. Tracklist and cover art finds are
  "announced".
- **Spotify matcher** (`supabase/functions/match-spotify`) now checks every
  song, only accepts the same title by one of the song's own artists, and on a
  match sets the link, marks the song released and fills album and release
  date. Redeploy it, then run `run-spotify-matching.ps1`.
- **ChatGPT link suggestions:** "find links with ChatGPT" on artist pages opens
  ChatGPT with a short prompt. The connector's `get_songs_needing_links`,
  `suggest_link` and `mark_checked` tools add suggestions to each song's
  possible matches (tagged "via ChatGPT", with a suggested status, album and
  date). "Suggest as link" turns one into a correction for review.
- **Status checks in routines:** the research plan includes `needs_status`, up
  to 10 unconfirmed songs per artist; routines report what they can prove and
  mark the rest checked.
- **One-tap approve** on routine discoveries (`approve_discovery`), with
  "edit first" to send one to the queue instead.
- **Quick merge** on `/review/duplicates` for identical copies on one artist's
  page (same title, status and details, nothing collected, rated or commented).

## Shared research (20261018040000_routine_token_savings.sql)

Research is shared between everyone's routines so nobody pays twice:

- `search_since` per artist: whoever checked the artist last, minus two days
  of overlap. ChatGPT only looks for news after it.
- `recently_added`: songs added or whose status changed in the last 60 days.
- `already_handled`: finds approved or dismissed in the last 90 days.
- `open_discoveries`: finds waiting in review.

ChatGPT skips all of these without checking them. Anything else it finds is
checked in one `check_candidates` call (up to 50 titles), which also reports
`previously_dismissed` so turned-down finds aren't resubmitted. Songs now
record when they were added (`tracks.created_at`; older songs have none).

## Artist priority queue (20261018060000_artist_priority_queue.sql)

One shared ranking (`sc_artist_queue`) decides which artists get checked
next. Empty or thin pages, "request a check" presses (one per person per
artist per day), followers and recent finds push an artist up. Every check
that finds nothing makes the next one wait longer (1 day, 3 days, 1 week,
2 weeks, then 30 days); a find resets it. `finish_run` records per artist
whether anything was found. The research plan hands out each user's followed
artists in this order with `due` and `why`. Server jobs (imports) take
artists with `sc_claim_artists(source, count, per_hour)`, which caps how many
artists each source gets per hour. Admins see the queue at /admin/queue.
