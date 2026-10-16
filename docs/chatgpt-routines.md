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
