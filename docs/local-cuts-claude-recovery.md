# Local Cuts — Claude handover, ownership ledger and recovery guide

**Prepared:** 25 October 2026 (UTC)
**Repository:** https://github.com/dgtheswingingman-cloud/static-cuts
**Purpose:** Claude should be able to understand, continue, inspect, selectively correct or **completely revert** ChatGPT's Local Cuts code, without deleting unrelated work.
**Merge status verified 2026-10-26 19:59 UTC:** PRs #157–#163 are **merged** into `main` (including documentation PRs #159 and #161); #161, #162 and #163 merged on 2026-10-26 at 19:21:15, 19:21:28 and 19:21:44 UTC respectively. Latest verified `main` SHA: `8a9de3f367588788204f0eaa996458d69498abfd`. **#164 remains an unmerged draft with a failed Vercel deployment status; do not merge until the actual build failure is diagnosed and tests are run.** Earlier draft-status language in individual handovers is historical and is superseded by the status notes added in this documentation update.
**Scope:** This document tracks ChatGPT's five merged Local Cuts code changes (#157, #158, #160, #162, #163), recovery documentation (#159, #161), and unmerged draft #164. It is not a rollback of the entire Local Cuts feature or Claude's earlier code. Update the ledger after any later merge.

## 1. Source of truth / change ledger

| Order | PR / URL | Merge commit (main) | Files touched | Purpose |
|---|---|---|---|---|
| 1 | [#157 — safer file identities and match reassignment](https://github.com/dgtheswingingman-cloud/static-cuts/pull/157) | b455f274eb51dba69201e3127d4d80404afbfba7 | app/local/fileIdentity.ts (added); app/local/page.tsx (modified); tests/local-file-identity.test.mjs (added) | Avoid conflating different local audio files by filename+size, refresh file associations on match changes. |
| 2 | [#158 — require version confirmation before retagging](https://github.com/dgtheswingingman-cloud/static-cuts/pull/158) | fd2db01a3731d5521679e7f5da183218c2093486 | app/local/versionMatch.ts (added); app/local/page.tsx (modified); app/local/Tidy.tsx (modified); tests/local-version-match.test.mjs (added); docs/local-cuts-version-review-rollback.md (added) | Suggest demo/V2/etc. via catalogue metadata, make automatic matches review-only, block unconfirmed archive tags/collect, provide a browser-only reset. |
| 3 | [#160 — safer ZIP exports](https://github.com/dgtheswingingman-cloud/static-cuts/pull/160) | ec35a82c6f7d0f04c0c93e596ba3f7899223e603 | app/local/write.ts (modified); app/local/Tidy.tsx (modified); tests/local-zip.test.mjs (added); docs/local-cuts-zip-streaming-handover.md (added) | Stream Blob CRC checks, avoid full-size audio buffer copies, reject unsupported ZIP32 sizes and show ZIP packaging errors. |
| 4 | [#161 — post-#160 recovery docs](https://github.com/dgtheswingingman-cloud/static-cuts/pull/161) | d9cab3dfdfc210aa98db2b824988e2ca45150209 | docs/local-cuts-claude-recovery.md; docs/local-cuts-zip-streaming-handover.md | Documentation-only correction of #160's merge state and Spotify-first recovery guidance. |
| 5 | [#162 — MP3 tag bounds](https://github.com/dgtheswingingman-cloud/static-cuts/pull/162) | bcdd9570fd9ebf1ffdc70c4104abe3e1da09a0d6 | app/local/write.ts; tests/local-mp3-export.test.mjs (added); docs/local-cuts-mp3-bounds-handover.md (added) | Validate ID3v2 size/version/footer and ID3v1 bounds before retagging; reject tag-only/truncated inputs instead of losing audio bytes. |
| 6 | [#163 — FLAC metadata bounds](https://github.com/dgtheswingingman-cloud/static-cuts/pull/163) | 8a9de3f367588788204f0eaa996458d69498abfd | app/local/write.ts; tests/local-flac-export.test.mjs (added); docs/local-cuts-flac-bounds-handover.md (added) | Validate FLAC metadata block lengths, STREAMINFO and Vorbis bounds before retagging; reject malformed or audio-empty exports. |

**Recovery documentation:** [#159](https://github.com/dgtheswingingman-cloud/static-cuts/pull/159) merged as `262d61a6a0c62274eb29c9092c13f46eee22cb04`; [#161](https://github.com/dgtheswingingman-cloud/static-cuts/pull/161) merged as `d9cab3dfdfc210aa98db2b824988e2ca45150209`. This follow-up documentation PR is separate and does not change audio processing.

#157 and #158 were documented as regular two-parent GitHub merge commits. GitHub's commit API confirmed **two parents for #161, #162 and #163** on 2026-10-26; #160's parentage should still be verified before reverting. **Always verify the actual parent count with `git show --no-patch --pretty=%P <sha>` before using `git revert -m 1`**. For a two-parent merge, first parent follows main and `-m 1` selects it as the mainline. For a single-parent squash commit, omit `-m 1`.

Inspect current main and compare the actual PR changes before any revert; other developers or automated work may have modified the same files after these merges. This ledger is a snapshot, not an instruction to overwrite later code.

## 1A. 2026-10-26 merge reconciliation, safety and pending review

**Verified merge sequence (GitHub PR and commit APIs):** #161 `d9cab3dfdfc210aa98db2b824988e2ca45150209` (19:21:15 UTC; two parents), #162 `bcdd9570fd9ebf1ffdc70c4104abe3e1da09a0d6` (19:21:28 UTC; two parents), #163 `8a9de3f367588788204f0eaa996458d69498abfd` (19:21:44 UTC; two parents). Each changed-file list was checked against GitHub. Vercel's **commit status** was `success` for all three merge SHAs when queried; this does **not** establish successful application test suites, browser export or Spotify imports. No full repository checkout, lint or build was executed in this ledger update.

**#162 user impact:** a malformed MP3 with invalid/truncated ID3 metadata or mismatched v2.4 footer now fails that individual export rather than risking an audio-empty or truncated copy. The source recording is never written. See `docs/local-cuts-mp3-bounds-handover.md`. **#163 user impact:** malformed/truncated FLAC metadata and invalid Vorbis boundaries now fail rather than exporting a corrupt or audio-empty copy. See `docs/local-cuts-flac-bounds-handover.md`. Both preserve canonical/user-overridden tagging for valid supported inputs; neither changes matching logic. These are source-level intentions, **not verified real-file/Spotify outcomes**.

**Data/API/privacy/cost/storage for #161–#163:** no migrations, new API endpoints, server writes, new dependencies, browser storage keys, uploaded audio, new paid services, production settings or original-file writes. Existing local processing may reject malformed recordings that previously yielded bad copies. No confirmed increase in remote API/hosting costs from these PRs.

**Precise reviewed rollback after the merges:** create a new branch from the latest `main`, check intervening commits and `git show --no-patch --pretty=%P` for the selected merge, then use `git revert -m 1 <merge-sha>` only for a verified two-parent merge, inspect the diff, run tests/build and open a separate draft PR. If undoing both audio changes, **revert #163 before #162**; #162's `write.ts` MP3 changes must not be removed by a FLAC-only revert. #161 is documentation-only and should normally remain as provenance. Never revert the whole `app/local/write.ts` file or reset main; preserve #157/#158/#160, unrelated Claude changes, originals and exports. Reverting #163 or #162 is a separate human-reviewed decision, not an action performed by this documentation update.

**Pending #164 (rechecked 2026-10-26 21:59 UTC):** [draft PR #164](https://github.com/dgtheswingingman-cloud/static-cuts/pull/164) remains **unmerged**, head `1cf12bb5ea24d1822a0f8c58e56e789d1cfd2ac4` at this inspection. Its original base was pre-#161–#163 main `ec35a82c6f7d0f04c0c93e596ba3f7899223e603`. GitHub compare reports the branch **60 commits ahead and 22 commits behind current main**, so a mergeable flag does not establish compatibility with the newly merged MP3/FLAC writer guards. Latest GitHub Vercel commit status: **failure** at 2026-10-26 21:12:45 UTC (deployment `dpl_AGWcgkQjgDS34i2P53r6rQaCzni9`); the separate Preview Comments check succeeded but **is not a build**. The actual Vercel build logs were not available through this GitHub connection; cause unknown. Do not merge #164 until Claude diagnoses the build and verifies compatibility with newly merged #162/#163, full tests, browser copies and Spotify imports. #164's own handover is `docs/local-cuts-custom-templates-handover.md` **on its draft branch**, not on main. No #164 merge SHA exists.

**Mandatory checks after these merges (not run here):**
~~~bash
node --experimental-strip-types --test tests/local-file-identity.test.mjs tests/local-version-match.test.mjs tests/local-zip.test.mjs tests/local-mp3-export.test.mjs tests/local-flac-export.test.mjs
npm run lint
npm run build
~~~
Then test copies of real MP3/FLAC files, compare original/exported audio bytes, inspect tags/artwork with independent tools and verify Spotify Local Files import. Do not mistake isolated V8/Node reconstructions described in the individual handovers for full checkout tests.

## 2. What this changes in user behaviour

**PR #157:** local file keys use folder-relative path, file length and SHA-256 of sampled start/end bytes, rather than just filename plus length. This is a reconnection identifier, **not** an acoustic fingerprint. Local files remain in browser memory; file associations on song pages are limited to confirmed matches. Legacy saved items with old key format are not automatically migrated. On manual reassignment, the previous mapped audio file is cleared where appropriate.

**PR #160:** ZIP export reads Blob chunks to compute CRC without allocating a full-length Uint8Array per recording, validates ZIP32 size/path/entry limits, and catches ZIP packaging errors in the UI. It does not add ZIP64, solve all browser-memory constraints, or verify Spotify Local Files compatibility.

**PR #158:** the shared database RPC (rpc_match_my_songs) still returns an artist/title-based candidate. Local Cuts fetches the selected song's linked version family and checks exact version labels in filenames / metadata. It can recommend a candidate V2, demo, etc., but **every automatic choice remains "check"** until a user confirms it. A title match does not prove which recording the file contains. Tidy & Save obtains archive metadata only for confirmed "sure" items, otherwise preserves the local file metadata. New automatic suggestions cannot be bulk-collected until confirmed. The reset button clears local saved matching data and tidy preferences.

None of #157, #158 or #160 performs acoustic analysis or proves audio identity. None adds a database migration or new production service. They are incremental improvements, not a redesign of Local Cuts.

## 3. Revert exactly our work, not the rest of the site

### A. If only PR #160 is a problem

Use GitHub's Revert action on [PR #160](https://github.com/dgtheswingingman-cloud/static-cuts/pull/160) to propose a reviewed inverse PR. Its actual merge SHA is **`ec35a82c6f7d0f04c0c93e596ba3f7899223e603`**. If `git show --no-patch --pretty=%P` confirms a regular two-parent merge:

~~~bash
git fetch origin
git switch main
git pull --ff-only
git switch -c revert/local-cuts-zip-160
git show --no-patch --pretty=%P ec35a82c6f7d0f04c0c93e596ba3f7899223e603
git revert -m 1 ec35a82c6f7d0f04c0c93e596ba3f7899223e603
# Review changed files, run tests/lint/build, push new branch and open a PR.
~~~

If it is a single-parent squash commit, use `git revert ec35a82c6f7d0f04c0c93e596ba3f7899223e603` instead. Do not delete #157, #158, #159 or unrelated Claude changes. If later work modifies the ZIP helper, inspect and resolve any conflicts narrowly.

### B. If only PR #158 is a problem
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

### C. If PRs #157 and #158 need removal (but keep #160)
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

### D. If all three code PRs need removal

Revert in reverse order: **#160, then #158, then #157**, on a new branch after checking dependency and merge parents. For confirmed regular two-parent merge commits:

~~~bash
git fetch origin
git switch main
git pull --ff-only
git switch -c revert/local-cuts-chatgpt-157-158-160
git revert -m 1 ec35a82c6f7d0f04c0c93e596ba3f7899223e603
git revert -m 1 fd2db01a3731d5521679e7f5da183218c2093486
git revert -m 1 b455f274eb51dba69201e3127d4d80404afbfba7
# Review diff and conflicts; run tests/lint/build; push and open a review PR.
~~~

Never use these commands blindly: verify merge parentage, check later commits, and preserve unrelated changes. Documentation PR #159 can remain as historical provenance even if code is reverted; update its status instead of deleting history.

### E. If future hourly ChatGPT PRs also get merged
Add their PR number, merge commit SHA, file list, migration risk and rollback sequence to this ledger. Revert later merged changes first if they depend on earlier ones. **This file does not magically track future changes**; Claude must inspect the repository and PR history.

### F. Source-level selective removal
For surgical removal, use each PR's **Files changed** tab as the canonical diff:
- #157: remove fileIdentity.ts + its test only if unused by later code, then reverse its page.tsx key/mapping edits without deleting subsequent features.
- #158: remove versionMatch.ts + its test only if unused, and reverse its page.tsx + Tidy.tsx edits. Its old docs/local-cuts-version-review-rollback.md can also be removed.
- #160: reverse only `makeZip`/`crc32Blob` edits in app/local/write.ts and the ZIP-specific error handling in app/local/Tidy.tsx; remove tests/local-zip.test.mjs and its standalone handover only if no later code depends on them. This is a fallback to a reviewed inverse patch, not a recommendation to restore an unsafe ZIP implementation.
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
node --experimental-strip-types --test tests/local-zip.test.mjs
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

**PR #160 verification provenance:** its original author reported four isolated Node ZIP-helper tests passing, an isolated TypeScript check passing, and an independent Python ZIP integrity check. Those were **not run against the full repository**. A GitHub Vercel commit status of `success` was observed for the merged SHA, but no CI logs or real browser/audio/Spotify validation were inspected in this documentation-only run. Treat full checkout tests and Spotify Local Files checks as pending.

Known architectural trade-offs / possible defects to investigate:
- #157 samples only the start and end of a recording; collisions are still theoretically possible if distinct files share those samples and length/path.
- A reconnect after re-tagging/export creates different bytes and may yield a new identifier; old key migration is not automatic.
- #158's existing SQL match RPC picks one title candidate; linked version lookup only explores that chosen family, not every possible song family.
- #158 uses a per-batch 1,000-row child-version cap; incomplete/error responses should remain review-only. Check behaviour on larger or unusually duplicated catalogues.
- Candidate labels are not evidence of identical audio. Treat everything as a suggestion.
- Export and tagging still require end-to-end tests for tag integrity, artwork fetching, ZIP size/memory, M4A support, Unicode names, browser compatibility, and whether Spotify actually reads the exported tags and artwork.
- #160's ZIP writer rejects archives over ZIP32 limits; it does not support ZIP64, and browser memory use is not constant. Verify Blob.stream() support on target clients.

## 6. Product direction and working agreement for Claude and the hourly task

**Product priority confirmed by the user on 2026-10-25:** Local Cuts is primarily an **automatic canonical formatter for Spotify Local Files**, not a standalone music player. Prioritise trustworthy matching to the correct Static Cuts song/version, canonical artist/title/version/album/artwork tags, Spotify-compatible export and batch processing. **Canonical formatting is the default; individual user overrides and saved custom preferences must remain possible.** Never overwrite original recordings; preview and review uncertain matches. A separate player is a possible later nice-to-have, not a current development priority. Do not infer that Spotify supports every tag/container without client testing.

1. Inspect main, open PRs and this ledger before editing Local Cuts. Check user-confirmed Spotify-first product direction above. Do not duplicate already merged fixes.
2. Use a **separate, clearly named branch** for every coherent change, with a **draft PR**. Never auto-merge or deploy.
3. Record exact changed paths and the user-visible change. State database/storage impacts (including "none").
4. Include **exact reverse instructions** in the PR description. For merged PRs, add the actual merge commit SHA here.
5. Test where possible; distinguish tests written from tests actually executed.
6. Preserve original audio files by default; export into newly generated copies.
7. If rollback conflicts with later Claude code, preserve later changes and perform a targeted revert rather than a repository-wide reset.
8. The hourly development task is independent of GitHub history. **Reverting code does not disable the hourly task.** Ask the user to disable "Hourly Local Cuts Development" in ChatGPT if they want further automated changes to stop.

## 7. Claude's immediate workflow if asked "undo ChatGPT's Local Cuts work"

1. Check PRs #157, #158, #159 and #160 in GitHub. Verify merge state and actual commit SHAs against this document.
2. Ask whether to remove #160 only, #158 only, #157–#158, all three code PRs, or merely reset browser data **only when genuinely unclear**; otherwise follow the user's specified scope.
3. Review other commits after the merge before applying a revert.
4. Create a new revert branch; verify parentage, then use `git revert -m 1` for confirmed merge commits in reverse order (#160, #158, #157 as applicable), or carefully construct targeted inverse patches if conflicts arise.
5. Run checks and compare the resulting Local Cuts behaviour against the pre-PR state.
6. Open a review PR and describe exactly what was undone, what remains and what (if any) manual browser cleanup is needed.
7. Never remove unrelated changes or claim originals/exports/remote collections were deleted.

## 8. Links

- [Static Cuts repository](https://github.com/dgtheswingingman-cloud/static-cuts)
- [Merged PR #157](https://github.com/dgtheswingingman-cloud/static-cuts/pull/157)
- [Merged PR #158](https://github.com/dgtheswingingman-cloud/static-cuts/pull/158)
- [Merged PR #159 — recovery docs](https://github.com/dgtheswingingman-cloud/static-cuts/pull/159)
- [Merged PR #160 — ZIP export](https://github.com/dgtheswingingman-cloud/static-cuts/pull/160)
- [PR #160 detailed ZIP handover](https://github.com/dgtheswingingman-cloud/static-cuts/blob/main/docs/local-cuts-zip-streaming-handover.md)
- [Merged PR #161 — post-ZIP recovery docs](https://github.com/dgtheswingingman-cloud/static-cuts/pull/161)
- [Merged PR #162 — MP3 bounds](https://github.com/dgtheswingingman-cloud/static-cuts/pull/162)
- [Merged PR #163 — FLAC bounds](https://github.com/dgtheswingingman-cloud/static-cuts/pull/163)
- [Unmerged draft PR #164 — canonical formatting and custom templates](https://github.com/dgtheswingingman-cloud/static-cuts/pull/164)
- [Prior rollback file, now superseded for merge status](https://github.com/dgtheswingingman-cloud/static-cuts/blob/main/docs/local-cuts-version-review-rollback.md)

**Bottom line (verified 2026-10-26):** Code rollback should use narrow reviewed inverse PRs, never delete Local Cuts, original audio, exports or reset main. #157–#163 are merged; #164 is an unmerged, failing-build draft. Continue updating this ledger after later merges.
