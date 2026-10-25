# Local Cuts — Claude handover, ownership ledger and recovery guide

**Prepared:** 25 October 2026 (UTC)
**Repository:** https://github.com/dgtheswingingman-cloud/static-cuts
**Purpose:** Claude should be able to understand, continue, inspect, selectively correct or **completely revert** ChatGPT's Local Cuts code, without deleting unrelated work.
**Status at preparation:** PRs #157 and #158 have **both been merged** into main. This supersedes the outdated "still draft" instructions in docs/local-cuts-version-review-rollback.md.
**Scope:** This document is about ChatGPT's two Local Cuts changes, not about reverting the entire Local Cuts feature or Claude's earlier code.

## 1. Source of truth / change ledger

| Order | PR / URL | Merge commit (main) | Files touched | Purpose |
|---|---|---|---|---|
| 1 | [#157 — safer file identities and match reassignment](https://github.com/dgtheswingingman-cloud/static-cuts/pull/157) | b455f274eb51dba69201e3127d4d80404afbfba7 | app/local/fileIdentity.ts (added); app/local/page.tsx (modified); tests/local-file-identity.test.mjs (added) | Avoid conflating different local audio files by filename+size, refresh file associations on match changes. |
| 2 | [#158 — require version confirmation before retagging](https://github.com/dgtheswingingman-cloud/static-cuts/pull/158) | fd2db01a3731d5521679e7f5da183218c2093486 | app/local/versionMatch.ts (added); app/local/page.tsx (modified); app/local/Tidy.tsx (modified); tests/local-version-match.test.mjs (added); docs/local-cuts-version-review-rollback.md (added) | Suggest demo/V2/etc. via catalogue metadata, make automatic matches review-only, block unconfirmed archive tags/collect, provide a browser-only reset. |

**Both merge commits have two parents** (regular GitHub merge commits). First parent follows main; second parent points to the feature branch. This is why the safe command-line revert uses **git revert -m 1**.

Inspect current main and compare the actual PR changes before any revert; other developers or automated work may have modified the same files after these merges. This ledger is a snapshot, not an instruction to overwrite later code.

## 2. What this changes in user behaviour

**PR #157:** local file keys use folder-relative path, file length and SHA-256 of sampled start/end bytes, rather than just filename plus length. This is a reconnection identifier, **not** an acoustic fingerprint. Local files remain in browser memory; file associations on song pages are limited to confirmed matches. Legacy saved items with old key format are not automatically migrated. On manual reassignment, the previous mapped audio file is cleared where appropriate.

**PR #158:** the shared database RPC (rpc_match_my_songs) still returns an artist/title-based candidate. Local Cuts fetches the selected song's linked version family and checks exact version labels in filenames / metadata. It can recommend a candidate V2, demo, etc., but **every automatic choice remains "check"** until a user confirms it. A title match does not prove which recording the file contains. Tidy & Save obtains archive metadata only for confirmed "sure" items, otherwise preserves the local file metadata. New automatic suggestions cannot be bulk-collected until confirmed. The reset button clears local saved matching data and tidy preferences.

Neither PR performs acoustic analysis or proves audio identity. Neither PR adds a database migration or a new production service. Neither PR is a complete redesign of the original Local Cuts system.

## 3. Revert exactly our work, not the rest of the site

### A. If only PR #158 is a problem
Revert merge commit **fd2db01a3731d5521679e7f5da183218c2093486** via GitHub's Revert button on [PR #158](https://github.com/dgtheswingingman-cloud/static-cuts/pull/158) if it can create a revert PR. Review and merge that **new** PR. PR #157 remains in place.

Or, from a correctly configured checkout:

~~~bash
git fetch origin
git switch main
git pull --ff-only
git switch -c revert/local-cuts-version-review
git revert -m 1 fd2db01a3731d5521679e7f5da183218c2093486
# Run lint/build/tests and review diff. Push this NEW branch and open a PR.
~~~

### B. If both of our Local Cuts PRs need removal
**Revert in reverse chronological order: #158 first, then #157.** This protects intervening changes better than rolling main backwards:

~~~bash
git fetch origin
git switch main
git pull --ff-only
git switch -c revert/local-cuts-chatgpt-20261025

git revert -m 1 fd2db01a3731d5521679e7f5da183218c2093486
git revert -m 1 b455f274eb51dba69201e3127d4d80404afbfba7

# Inspect the exact diff. Run tests and build; open a review PR.
npm run lint
npm run build
git push -u origin revert/local-cuts-chatgpt-20261025
~~~

These commands are **instructions for Claude to execute after inspecting repository state**, not evidence that they have already been executed. GitHub may refuse a revert due to later conflicting edits. If so, **do not force it or blindly accept deletions**. Abort/reassess or perform targeted inverse patches, preserving unrelated work. The merge commits are anchored identifiers and must not be confused with the feature-branch head commits.

**Never use git reset --hard on main, force-push main, or restore the whole app/local directory from an old commit.** Other development may be present.

### C. If future hourly ChatGPT PRs also get merged
Add their PR number, merge commit SHA, file list, migration risk and rollback sequence to this ledger. Revert later merged changes first if they depend on earlier ones. **This file does not magically track future changes**; Claude must inspect the repository and PR history.

### D. Source-level selective removal
For surgical removal, use each PR's **Files changed** tab as the canonical diff:
- #157: remove fileIdentity.ts + its test only if unused by later code, then reverse its page.tsx key/mapping edits without deleting subsequent features.
- #158: remove versionMatch.ts + its test only if unused, and reverse its page.tsx + Tidy.tsx edits. Its old docs/local-cuts-version-review-rollback.md can also be removed.
- Do not delete or replace app/local/page.tsx or Tidy.tsx wholesale.

## 4. Browser data, exported audio and database data are different

**Local-only saved keys** used by this code:
- static_cuts_local_cuts — item metadata, song IDs, candidate status and manual decisions.
- static_cuts_tidy_prefs — preferred filename/folder styles and cover-art setting.

On /local, the "reset Local Cuts" action clears those two browser storage keys plus this page's remembered file references and selected playback state. The button only appears in the current UI when the page has items. If the page cannot be opened and the user specifically approves a browser-only reset, Claude can instruct them to clear just these two keys through their own browser developer tools.

**This does not remove**:
- Original audio files on disk.
- Previously saved "Static Cuts YYYY-MM-DD" export folders or downloaded ZIPs.
- Songs deliberately added to the server-side user's collection (track_ownership).
- Site catalogue rows or production database data.
- Browser data from other devices.

Do NOT automatically delete local recordings, export folders or collection rows as part of code rollback. Request explicit user action for those distinct operations.

If older auto-matched items are downgraded to "check" after PR #158, reverting #158 does not reconstruct every historical match or automatically restore data that the user has since edited. Back up and inspect the relevant browser data first if preserving it matters.

## 5. Current limitations / verification that Claude must own

Do not interpret a successful GitHub merge as evidence the code is correct. The PR descriptions contain statements about focused tests; **there is no complete CI/browser/real-file validation documented in this handover**. Run all checks again yourself and report exact results:

~~~bash
node --experimental-strip-types --test tests/local-file-identity.test.mjs
node --experimental-strip-types --test tests/local-version-match.test.mjs
npm run lint
npm run build
~~~

Also perform manual browser tests with *copies* of:
- Two different audio files with the same filename and byte length; same filenames in different folders.
- A main song, V2, demo, duplicate version titles, and a filename that misleadingly resembles another version.
- No-artist files; unknown catalogue entries; records with multiple artists.
- Previously saved automatic "sure" rows and manual "sure" confirmations.
- Reassigning or clearing a match, including song-page "Play my file".
- Unconfirmed matching followed by **Tidy & Save**: no unwanted archive metadata injection.
- Reset on a browser with remembered items: originals and server-side collection must remain unchanged.

Known architectural trade-offs / possible defects to investigate:
- #157 samples only the start and end of a recording; collisions are still theoretically possible if distinct files share those samples and length/path.
- A reconnect after re-tagging/export creates different bytes and may yield a new identifier; old key migration is not automatic.
- #158's existing SQL match RPC picks one title candidate; linked version lookup only explores that chosen family, not every possible song family.
- #158 uses a per-batch 1,000-row child-version cap; incomplete/error responses should remain review-only. Check behaviour on larger or unusually duplicated catalogues.
- Candidate labels are not evidence of identical audio. Treat everything as a suggestion.
- Existing file-writing/export functions predate these PRs and require separate tests for tag integrity, artwork fetching, ZIP size/memory, M4A support and browser compatibility.

## 6. Working agreement for Claude and the hourly task

1. Inspect main, open PRs and this ledger before editing Local Cuts. Do not duplicate already merged fixes.
2. Use a **separate, clearly named branch** for every coherent change, with a **draft PR**. Never auto-merge or deploy.
3. Record exact changed paths and the user-visible change. State database/storage impacts (including "none").
4. Include **exact reverse instructions** in the PR description. For merged PRs, add the actual merge commit SHA here.
5. Test where possible; distinguish tests written from tests actually executed.
6. Preserve original audio files by default; export into newly generated copies.
7. If rollback conflicts with later Claude code, preserve later changes and perform a targeted revert rather than a repository-wide reset.
8. The hourly development task is independent of GitHub history. **Reverting code does not disable the hourly task.** Ask the user to disable "Hourly Local Cuts Development" in ChatGPT if they want further automated changes to stop.

## 7. Claude's immediate workflow if asked "undo ChatGPT's Local Cuts work"

1. Check PR #157 and #158 in GitHub. Verify merge state and commits against this document.
2. Ask whether to remove #158 only, both PRs, or merely reset their browser data **only when this is genuinely unclear**; otherwise follow the user's specified scope.
3. Review other commits after the merge before applying a revert.
4. Create a new revert branch; use git revert -m 1 in reverse order or carefully construct targeted inverse patches if conflicts arise.
5. Run checks and compare the resulting Local Cuts behaviour against the pre-PR state.
6. Open a review PR and describe exactly what was undone, what remains and what (if any) manual browser cleanup is needed.
7. Never remove unrelated changes or claim originals/exports/remote collections were deleted.

## 8. Links

- [Static Cuts repository](https://github.com/dgtheswingingman-cloud/static-cuts)
- [Merged PR #157](https://github.com/dgtheswingingman-cloud/static-cuts/pull/157)
- [Merged PR #158](https://github.com/dgtheswingingman-cloud/static-cuts/pull/158)
- [Prior rollback file, now superseded for merge status](https://github.com/dgtheswingingman-cloud/static-cuts/blob/main/docs/local-cuts-version-review-rollback.md)

**Bottom line:** Code rollback should be handled as a pair of narrow Git revert PRs, not by deleting Local Cuts, deleting audio, or resetting main. New ChatGPT changes must be added to this ledger as they land.
