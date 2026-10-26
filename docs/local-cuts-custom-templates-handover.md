# Claude handover — Local Cuts custom Spotify export layouts

**Prepared:** 2026-10-26 UTC
**Repository:** https://github.com/dgtheswingingman-cloud/static-cuts
**Branch:** feat/local-cuts-custom-export-templates-20261026
**PR:** [Draft PR #164 — saved custom filename and folder templates](https://github.com/dgtheswingingman-cloud/static-cuts/pull/164)
**Base:** main at **ec35a82c6f7d0f04c0c93e596ba3f7899223e603** (includes merged PR #160).
**Merge status:** NOT merged. Actual merge SHA is unknown until review/merge.
**Scope:** Local Cuts formatting UI, canonical metadata readiness and match-reassignment override safety; no catalogue schema, matching RPC, audio writer or production settings changes.

## 1. Aim, observed limitation and evidence

The user confirmed canonical Static Cuts metadata must remain the default for confirmed recordings, with saved user-customizable formatting for Spotify Local Files exports. Inspection of main's app/local/Tidy.tsx showed only three hard-coded filename presets and three folder presets. The underlying renderer already supported several tokens, but users could not type a custom layout. The old renderer also silently dropped unknown {token} placeholders. This is source evidence, **not** a claimed customer incident.

This PR makes filename/folder templates editable and persistent **without changing the match-confirmation gate**. Later commits additionally require validated canonical metadata before a confirmed recording can be exported, avoiding silent local-tag fallback. The existing audio writer is unchanged. A standalone player is explicitly out of scope.

## 2. Base, exact changed paths, functions and why

| Path | Function/logic | Exact change and reason |
| --- | --- | --- |
| app/local/Tidy.tsx | Tidy() state and preference effects | Add customNameTpl, customFolderTpl, nameMode, folderMode, prefsReady; retain existing n/f/c keys and add cn/cf/nm/fm within static_cuts_tidy_prefs. Hydration guard prevents overwriting saved choices on initial mount. |
| app/local/Tidy.tsx | Filename/folder controls | Keep existing preset selectors; add Custom template… option, text inputs, token guidance, inline errors, and disable export for invalid templates. Switching to a preset retains the last custom layout. |
| app/local/Tidy.tsx | plan memo and save() | Replace local fill() with formatTemplate() and formatFolderSegments() for path previews/export; preserve safeName() segment sanitization and duplicate suffix logic; reject invalid templates before export. Block confirmed exports until canonical metadata is loaded and validated. |
| app/local/Tidy.tsx | metadata lookup effect and retry UI | Fetch only connected confirmed IDs; detect missing/incomplete catalogue rows and parent records, show errors and allow retry rather than silently exporting fallback tags. |
| app/local/canonicalReady.ts | confirmedExportIds(), missingCanonicalIds() | Pure helpers for connected confirmed track IDs and canonical metadata readiness; guard against inherited prototype keys. |
| tests/local-canonical-ready.test.mjs | 7 test cases | Regression tests for confirmed/unconfirmed/disconnected files, deduplication, missing metadata, prototype keys and readiness. |
| app/local/formatTemplate.ts | templateError() | Reject unknown tokens, unmatched braces, control characters, >160-character templates, and blank filename templates; permit blank folder template. |
| app/local/formatTemplate.ts | formatTemplate() | Render {artist}, {title}, {album}, {year}, {track}; remove optional empty token wrappers and dangling template separators while preserving literal brackets, leading/trailing punctuation and spacing inside canonical metadata. The follow-up correction cleans only template text before restoring values. |
| tests/local-format-template.test.mjs | 12 test cases | Original nine cases plus regressions for canonical leading/trailing punctuation, canonical double spaces, and empty-template-field separator cleanup. |
| docs/local-cuts-custom-templates-handover.md | This handover | Evidence, compatibility, tests, risks, Claude next steps and reversible rollback. |

Follow-up section 21 additionally modifies `app/local/page.tsx` to clear stale manual tag overrides on track/version reassignment. Verify the current PR file list/diff (seven paths in total).

## 3. Before and after user behaviour

**Before:** Only Artist - Title, Title, 01 Title filenames; Artist / Album, Artist, all-in-one folders. Preset and cover-art preference saved locally.

**After:** Presets remain the defaults. User can select Custom template… and enter e.g. filename {track} - {title} [{year}] or folder {artist}/{album} - {year}. The existing preview shows resulting paths; custom choices persist in browser storage. Unknown placeholders visibly error and block export rather than silently disappearing. Existing per-track title/artist/album/year overrides remain available. Confirmed connected recordings must now finish a validated canonical metadata lookup before export; lookup errors block export and offer retry.

**Important:** Templates change exported filenames/directories **only**, not the tags embedded in audio. Confirmed matches continue to receive canonical archive metadata by default. Unconfirmed/unknown matches do not receive archive metadata. Original recordings remain untouched.

## 4. Technical assumptions, dependencies and existing-feature effects

- Uses existing React client state, localStorage, Tidy plan, safeName(), folder picker and ZIP export. **No new dependencies**.
- Formatting receives canonical-or-local values plus explicit per-track overrides. No new matching/version inference, artwork-download implementation, tag-writing logic or audio transformation. **Existing Supabase track/parent metadata reads are now validated and retried on request** for confirmed connected files.
- Existing extension detection and duplicate-path suffixes (2), (3) etc. are unchanged.
- Existing safeName() sanitizes forbidden filesystem characters per segment; only template / characters separate folders. Empty folder levels are skipped. Long/deep layouts and Windows reserved names still require browser testing.
- Saved n/f/c preferences remain readable. New mode/custom fields are additive; prefsReady gates writing until hydration finishes.
- Empty custom folder is equivalent to all-in-one; blank filename is blocked.
- MP3/FLAC are retagged by existing code; M4A/WAV/OGG remain rename/sort-only. Spotify codec support is **not** validated by this PR.

## 5. Data/API/privacy/cost/browser-storage consequences

**Database or schema migration:** none. **New API endpoints:** none. **Existing API requests:** Supabase track/parent metadata reads now check completeness and errors; explicit retry may issue additional reads. **External services/AI:** none. **Incremental API/server cost:** possible extra catalogue reads on retry; no new paid service. **Permissions:** none. **Uploaded audio:** none. **Original audio writes/deletions:** none. **Production settings:** unchanged. **Catalogue/ownership data:** unchanged.

**Browser storage:** existing static_cuts_tidy_prefs key adds optional cn/cf (last custom layouts) and nm/fm (selection modes). Existing n/f/c meanings are preserved. Layouts are local to this browser and not synced. Existing reset removes the whole key. Existing static_cuts_local_cuts matched-item data is not migrated.

**Export copies:** File/folder names can change if the user selects custom layouts. Confirmed connected recordings are additionally blocked until canonical metadata is validated. Metadata writer, cover downloading and ZIP/folder output implementations remain unchanged.

## 6. Tests actually RUN, exact commands/results vs missing checks

A full checkout could not be obtained: git ls-remote https://github.com/dgtheswingingman-cloud/static-cuts.git HEAD failed with **Could not resolve host: github.com**. GitHub connector was used to read/write files.

**Executed on Node.js v22.16.0 against an isolated local copy of the same new helper and test contents** (not a full repository checkout):

~~~bash
node --experimental-strip-types --test /mnt/data/localcuts-format-review/tests/local-format-template.test.mjs
# 9 passed, 0 failed (including missing-year folder assertion)
tsc --noEmit --strict --target es2022 --module esnext --lib dom,es2022 /mnt/data/localcuts-format-review/app/local/formatTemplate.ts
# Passed (isolated helper only)
~~~

**Not executed:** committed test file from full repo, existing Local Cuts tests, npm run lint, npm run build, TypeScript/Next compilation of Tidy.tsx, browser UI/storage tests, real MP3/FLAC exports or Spotify Local Files import. Isolated tests do not establish React/browser compatibility. Never assert these passed.

## 7. Edge cases and unresolved risks

- Test custom→preset→custom, reload, old n/f/c preferences and browser reset.
- Test unknown token, malformed braces, blank filename, blank folder, missing year/track, Unicode, Windows filenames, long/deep paths and duplicate output names.
- Empty template-derived folder segments are skipped after the follow-up fix in section 14. The existing safeName() fallback Untitled can still apply to nonempty segments that sanitize to an empty name; Windows reserved device names and filesystem reliability remain untested.
- Existing folder-picker errors/permissions and ZIP fallback remain independent.
- formatTemplate() removes empty placeholder wrappers in templates while preserving literal brackets, punctuation and whitespace inside metadata values. **Existing safeName() still normalizes spaces and removes filesystem-unsafe characters in the final exported filename**; this follow-up only protects values inside the layout renderer. Test actual filename behaviour with real recordings.
- No artwork override UI, acoustic fingerprinting, custom embedded ID3 metadata template or automated recording identity proof.
- Draft PRs #162 and #163 modify app/local/write.ts. This PR intentionally does not touch that file; combined export behaviour still needs regression testing.

## 8. Precise next steps for Claude and verification

1. Inspect latest main, PRs #161/#162/#163 and this branch. Confirm base ec35a82c6f7d0f04c0c93e596ba3f7899223e603 and the **six** changed paths in section 2 (including canonicalReady.ts and its tests).
2. Run committed tests: node --experimental-strip-types --test tests/local-format-template.test.mjs tests/local-canonical-ready.test.mjs, plus existing Local Cuts test suites. See section 15 for the verified 24-test isolated Node run.
3. Run npm run lint and npm run build; resolve real issues on this branch without rewriting unrelated Claude work.
4. Browser-test Chrome/Edge folder picker and ZIP fallback; verify custom input, preset switching, reload persistence, invalid templates, Unicode, duplicate paths and preview.
5. Export real MP3/FLAC **copies**; compare audio payloads and inspect tags. Test imports into Spotify Local Files on supported clients and report observed results.
6. Coordinate review with draft #162/#163. **Do not merge automatically.**
7. Only after human merge: record the **actual** merge SHA, PR number, file list and rollback sequence in docs/local-cuts-claude-recovery.md via a separate **documentation-only draft PR**. Do not edit main. Draft #161 already covers merged #160; reconcile instead of duplicating.

## 9. Reversible rollback (real merge SHA required)

**Before merge:** Close draft PR; main stays unchanged. No audio or browser data must be deleted.

**After merge:** Obtain the actual merge commit SHA from GitHub. If it is a normal two-parent merge, create a review branch and use:

~~~bash
git fetch origin
git switch main
git pull --ff-only
git switch -c revert/local-cuts-custom-export-templates
git revert -m 1 <ACTUAL_MERGE_COMMIT_SHA>
# Inspect diff, run tests/lint/build and open a separate revert PR.
~~~

If squash/rebase was used, identify actual commit(s) and do a targeted revert instead. Never invent a merge SHA, reset main, or overwrite later changes. New optional browser preference keys may remain harmlessly after rollback; do not delete user preferences without approval. Previously downloaded copies are unaffected.

## 10. What must NOT be reverted or removed

Do not remove unrelated Claude changes, Static Cuts archive, catalogue, matching RPCs, ownership data, production settings, original audio, existing exports or the whole Local Cuts app. Preserve merged #157 (file identity), #158 (version review), #159 (recovery ledger), #160 (ZIP safety) and draft #161 (recovery update), #162 (MP3 safety), #163 (FLAC safety), unless separately requested and reviewed. Do not replace Tidy.tsx wholesale from an old snapshot after future work lands; selectively reverse only this PR's changes.

**Conclusion:** This is a user-visible, reversible Spotify Local Files formatting enhancement. Canonical tags remain default; matching accuracy, artwork reliability and codec compatibility are separate future work.

## 11. Follow-up review correction — canonical title punctuation (2026-10-26 UTC)

**Observed defect and reproducible evidence:** Review of the PR's own `app/local/formatTemplate.ts` showed its final `.replace(/^\\s*[-–—]\\s*|\\s*[-–—]\\s*$/g, "")` and `.replace(/\\s{2,}/g, " ")` ran **after** metadata substitution. In the original PR branch, `formatTemplate("{title}", { title: "- Intro" })` returned `"Intro"` and `formatTemplate("{title}", { title: "A  B" })` returned `"A B"`. This is a concrete source-level regression risk to canonical **export filenames**, not evidence of corrupted embedded ID3/FLAC tags.

**Exact correction:** Updated `app/local/formatTemplate.ts::formatTemplate()` to remove optional empty wrappers from the user-entered template, temporarily represent nonempty metadata values with control-character-delimited numeric placeholders, clean only the template's dangling separators/spacing, then restore metadata strings verbatim. Validated templates already reject control characters. No change to `templateError()`, `Tidy.tsx`, `write.ts`, API, metadata matching or tag-writing logic. Updated `tests/local-format-template.test.mjs` with three additional cases (leading/trailing hyphens, double spaces, and empty-value separators), now **12** cases total.

**Before/after:** `{title}` with a canonical `- Intro` value previously rendered `Intro`; it now renders `- Intro`. `Track -` and `A  B` remain unchanged within `formatTemplate()`. Empty template fields still remove dangling template separators. Final filesystem names still pass through the existing `safeName()` sanitization (which normalizes whitespace), so do not claim literal double spaces survive the full export path. Embedded tags were never modified by this PR.

**Actual verification:** Re-fetched the committed helper and test file from GitHub before correction. Ran **12/12 focused assertions** in the GitHub connector's V8 JavaScript environment, by removing TypeScript-only annotations from the exact proposed helper source and executing the test bodies from `tests/local-format-template.test.mjs` with a minimal `test`/`assert.equal`/`assert.match` harness. **0 failed.** The pre-fix helper was also executed to reproduce `- Intro → Intro`. This is an **isolated JS harness**, not Node's `node:test` runner and not a full repository checkout. The earlier 9/9 Node tests and isolated `tsc` pass documented in section 6 apply to the earlier version; **neither Node nor `tsc` has been rerun on this correction**. `git ls-remote https://github.com/dgtheswingingman-cloud/static-cuts.git HEAD` was attempted again from the container and failed with `Could not resolve host: github.com`. Full lint/build, browser, real MP3/FLAC and Spotify checks remain unexecuted.

**Assumptions/dependencies/impact:** No new dependencies, server calls, database/schema changes, production settings, browser storage changes, privacy effects or cost changes. Existing saved templates and canonical default preset are unchanged. The original files are not read or written by the helper. Review the temporary-marker strategy for unvalidated templates or unusual literal control characters; `templateError()` prevents these in export, but preview may still render invalid text. Folder-segment normalization, Unicode filenames and cross-platform path lengths still require browser tests.

**Claude next verification:** Check branch head and this diff; run `node --experimental-strip-types --test tests/local-format-template.test.mjs`, `npm run lint`, `npm run build`, then test real filenames `- Intro`, `Track -`, `A  B`, missing year, Unicode and literal brackets in Chrome/Edge. Confirm original audio and embedded tags remain untouched by filename templating. Coordinate with draft MP3/FLAC safety PRs #162/#163; do not merge automatically.

**Rollback:** PR #164 is still draft. To drop only this correction before merge, reverse the changes to `formatTemplate()` and the three new tests in a fresh review commit on this draft branch; this intentionally reintroduces the punctuation bug. To remove all of PR #164, close the draft without merging. If later merged, obtain the **actual merge SHA** from GitHub and follow section 9's conditional two-parent/squash revert procedure on a separate branch, preserving later edits. Actual merge SHA is **not yet known**. Do **NOT** revert merged #157/#158/#159/#160, unrelated Claude changes, other open drafts, original recordings, server catalogue or production settings.

## 12. Follow-up — canonical metadata readiness gate (2026-10-26 UTC)

### (1) Aim and observed defect/evidence
On the current draft branch, `Tidy.tsx` fetched confirmed track metadata asynchronously but its `plan` used `a = info[track_id] || null` and fell back to the original file's title/artist/album while the query was pending or had failed. The Save button remained enabled, and fetch errors/partial results were ignored. Thus a user could confirm a recording and immediately export a copy with *local fallback tags instead of canonical Static Cuts tags*, without a warning. This is a source-level race/error-path defect; it has not been reproduced in a real browser.

### (2) Base, exact changed paths/functions and why
The PR remains based on **main `ec35a82c6f7d0f04c0c93e596ba3f7899223e603`**. This change was added **on the existing draft PR #164 branch**, not main, after the filename-template correction:
- `app/local/canonicalReady.ts` (new): `confirmedExportIds()` selects unique, confirmed track IDs **only for files connected for export**; `missingCanonicalIds()` identifies required archive rows not loaded, using an own-property check.
- `app/local/Tidy.tsx` (modified): import those helpers; key the canonical metadata effect by connected confirmed IDs and an explicit retry counter; check Supabase errors, missing rows, missing canonical title/artist and missing linked parent rows; ignore results from a cancelled effect; expose loading/error/retry status; disable Save and guard `save()` until every required confirmed row is loaded. Preserve the existing explicit per-track overrides, `formatTemplate()`, `tidiedCopy()`, and cover-art toggle.
- `tests/local-canonical-ready.test.mjs` (new): seven focused tests covering confirmation, connected files, null IDs, deduplication, partial/complete data, inherited prototype keys and unconfirmed/disconnected batches.
- `docs/local-cuts-custom-templates-handover.md` (this file): update scope, evidence, tests, risks and rollback.

The existing four paths from sections 1–11 remain part of PR #164; total expected changed paths are **six**: `app/local/Tidy.tsx`, `app/local/formatTemplate.ts`, `app/local/canonicalReady.ts`, `tests/local-format-template.test.mjs`, `tests/local-canonical-ready.test.mjs`, and this handover.

### (3) Before/after user behaviour
**Before:** Even a confirmed, connected recording could be exported before its archive lookup finished, silently using original tags and omitting canonical artwork. Archive query failures were indistinguishable from an unknown local track.

**After (proposed):** A confirmed, connected recording holds the Save button until its canonical metadata is fetched and validated. The UI reports loading, or an error with **retry archive lookup**. A confirmed row that disappeared or lacks a canonical title/artist blocks export rather than quietly degrading. Unconfirmed tracks and disconnected files do not unnecessarily block exports; users can still manually edit title, artist, album and year when metadata is available. Export still creates copies, not changes to original recordings.

### (4) Assumptions/dependencies/existing features
The existing `tracks` table and `artists(name)` relation remain the source of canonical data. Linked parent records are required when a confirmed version points to one; this is conservative and may block exports if catalogue relations are broken or access is restricted. All requests use the existing Supabase client. No new library or dependency. The effect uses a stable joined-ID dependency and a cancellation flag to avoid committing stale fetch results. It does **not** prove audio identity, repair wrong manual confirmations, or guarantee cover-image download success. The existing MP3/FLAC writers and ZIP output remain unchanged.

### (5) Data/API/privacy/cost/storage consequences
**Schema/database migrations:** none. **Database writes:** none. **New API endpoints/services:** none. **New permissions:** none. **Uploaded audio:** none. **Original audio writes/deletes:** none. **Production settings:** unchanged. **New browser-storage keys/migrations:** none beyond the existing PR's optional template preferences. **Server cost:** no new service; the existing track/parent SELECT queries remain, now limited to confirmed recordings connected for export. An explicit user retry can issue additional SELECTs. **Privacy:** only existing track IDs are requested; no audio bytes are uploaded. **Output behaviour:** export is withheld until canonical details are available; no change to tag-writing code or source recordings.

### (6) Tests actually run, exact commands/results, and missing checks
- Executed in a GitHub connector V8 JavaScript harness using the **retrieved branch helper and test bodies**, after removing only TypeScript annotations and Node test imports: **7 passed, 0 failed**. Also checked eight expected source-level wiring/error-handling patterns in the retrieved `Tidy.tsx`; these are **static checks, not React integration tests**.
- Executed on Node **v22.16.0** using an **isolated local reconstruction** of the new helper and test file (not a full checkout):
  `node --experimental-strip-types --test /mnt/data/local-cuts-canonical-check/tests/local-canonical-ready.test.mjs` → **7 passed, 0 failed**.
  `tsc --noEmit --strict --target es2022 --module esnext --lib es2022,dom /mnt/data/local-cuts-canonical-check/app/local/canonicalReady.ts` → **exit 0** (helper only).
- Attempted `git ls-remote https://github.com/dgtheswingingman-cloud/static-cuts.git HEAD` in the execution container → **failed: Could not resolve host: github.com**.
- **Not run:** complete committed repository tests, full TypeScript/Next build of `Tidy.tsx`, `npm run lint`, React/browser tests, real MP3/FLAC exports, or Spotify Local Files import.
- **Important CI warning:** the Vercel deployment status for draft head `5ae706393400ba5ef786ba16e7897ebe48b109f2` was **failure** at 2026-10-26 10:01:24 UTC; earlier head `45d9586fd5` and the two preceding helper/test commits reported success. The exact failure reason is **not available** from the GitHub status; Claude must inspect the Vercel build logs and fix any compilation/integration error before merge. A successful isolated helper test does not override this failure.

### (7) Edge cases and unresolved risks
- Missing/renamed/deleted confirmed track, missing `artists` relation, inaccessible parent, partial batch results, intermittent network failure, and user-triggered retry: deliberately block canonical export until resolved.
- Confirmed tracks with no connected audio are excluded from the readiness gate. Unconfirmed/local-only exports are allowed and keep their local metadata; this is intentional.
- Multiple connected files with the same confirmed track ID are deduplicated for lookup.
- A long-running request can leave export pending; no timeout has been implemented. Cancellation prevents stale effect updates, but needs browser verification.
- Previously loaded metadata is cached for the session; no live refresh after catalogue edits, and artwork CORS/HTTP failures can still silently omit artwork. These are separate follow-ups.
- Vercel failure is unresolved. **Do not treat this draft as merge-ready.**

### (8) Precise next steps for Claude/reviewer
1. Check PR #164's latest changed-file list and head; preserve the original custom-template feature and the section-11 punctuation correction.
2. **First diagnose the Vercel failure** for `5ae706393400ba5ef786ba16e7897ebe48b109f2` via build logs; correct only the actual error on this draft branch.
3. Run `node --experimental-strip-types --test tests/local-canonical-ready.test.mjs tests/local-format-template.test.mjs`, the existing Local Cuts suites, `npm run lint`, and `npm run build` in a real checkout; record exact outcomes.
4. Browser-test confirmed/unknown/unconfirmed mixes, slow/failed/partial archive fetches, retries, manual overrides, version parent fallback and ZIP/folder export; inspect resulting **copies** and compare originals.
5. Test Spotify Local Files with real MP3/FLAC recordings and report actual behaviour. Coordinate with draft writer PRs #162/#163. **Do not merge/deploy automatically.**
6. After an approved human merge, record the **actual merge SHA** and changed paths in `docs/local-cuts-claude-recovery.md` via a documentation-only draft PR, reconciling existing #161.

### (9) Reversible rollback
**Current state:** Draft #164, **not merged**; no merge SHA exists. To remove *only* this follow-up before merge, revert the three readiness paths/edits above on the draft branch while retaining the template work. To remove the whole draft, close PR #164 without merging; main remains unchanged. **After any eventual merge**, obtain the actual merge commit SHA, inspect later changes and follow section 9's conditional `git revert -m 1 <ACTUAL_MERGE_COMMIT_SHA>` procedure on a **new review branch** if a two-parent merge was used; otherwise revert actual squash/rebase commits or surgically reverse readiness changes. Never guess a merge SHA or force-push.

### (10) What must NOT be reverted/removed
Preserve all unrelated Claude work and Static Cuts catalogue/data, merged #157/#158/#159/#160, draft #161/#162/#163, original recordings, previously exported files, and the custom template/filename-correction changes already on #164. Do not reset `main`, delete audio, alter production settings, or undo unrelated later modifications to `Tidy.tsx`.


## 13. CI investigation and latest focused verification — 2026-10-26 11:00 UTC

**Start-of-run repository state:** `main` remains at `ec35a82c6f7d0f04c0c93e596ba3f7899223e603` (merged ZIP PR #160); no subsequent main commit. Draft PRs #161 (cumulative recovery ledger), #162 (MP3 bounds), #163 (FLAC bounds) and #164 (this branch) remain open. Unrelated PR #105 is also open. The main recovery ledger still ends with #157/#158; draft #161 already records merged #160. Do **not** duplicate the ledger PR or claim #162–#164 merged.

**Narrowed Vercel failure boundary (GitHub commit statuses, not build logs):**

| Commit | Change | Vercel status |
| --- | --- | --- |
| `45d9586fd561a2cbe67bd8430e1a1e68160b01b` | Template handover | success, 09:14:52 UTC |
| `64fe9a4ac76dcba1ad37ce8117adf5769c51a7bf` | New `canonicalReady.ts` helper | success, 10:00:41 UTC |
| `10eb47f6164e4e620db076b5f93741a06987053e` | New helper regression tests | success, 10:01:08 UTC |
| `5ae706393400ba5ef786ba16e7897ebe48b109f2` | Integrate metadata readiness in `Tidy.tsx` | **failure**, 10:01:24 UTC |
| `70be668de8b43afc2a6bcca99c8ea378efc078cb` | Documentation-only handover | **failure**, 10:03:21 UTC |

GitHub's actual diff for `5ae7063` modifies **only `app/local/Tidy.tsx`**. The first observed failure coincides with that integration commit, so **inspect that integration first**. This is a correlation, **not a confirmed compiler error or root cause**. GitHub's commit status provides no Vercel compiler output. The successful “Vercel Preview Comments” check is separate and **does not mean the build succeeded**. A browser attempt to open the Vercel deployment page was inaccessible. The container cannot resolve `github.com`, so it cannot clone the full repository.

**Actual additional test execution this run:** Retrieved both current helper sources and both committed test files directly from GitHub at branch head `70be668`. Executed all **19/19 test bodies** (12 formatting, 7 canonical-readiness) in a V8 JavaScript harness after stripping TypeScript-only syntax and Node test imports; **19 passed, 0 failed**. This validates those helper assertions in isolation only. It does **not** execute Node's test runner, TypeScript/React compilation, the `Tidy.tsx` integration, Next build, browser export, real recordings, or Spotify Local Files.

**Immediate reviewer action (before any further feature work or merge):**

1. Inspect the failed deployment's actual logs, with appropriate Vercel access: `npx vercel inspect dpl_6oCo2usNbfpUsn2mhLSNsSGQwcdo --logs` (first failed code commit) and `npx vercel inspect dpl_5BwtYmgrm8YaAUNPeHYbEvBtpkoa --logs` (current previous head). Record the exact diagnostic, not a guessed TypeScript cause.
2. Reproduce with a real checkout: `node --experimental-strip-types --test tests/local-format-template.test.mjs tests/local-canonical-ready.test.mjs`, `npm run lint`, `npm run build`. Check `Tidy.tsx` integration against React and Supabase types.
3. Fix only the demonstrated defect **on this draft branch**, run checks again, and update this handover with actual commands/results. Keep unrelated Claude changes and writer drafts #162/#163 intact.
4. Browser-test confirmed/unconfirmed mixes, metadata errors/retry, canonical titles/artwork, saved layouts and copy-only export; do not claim Spotify compatibility without importing real files.
5. Do not merge, deploy, alter production settings, or overwrite originals. Before merge, closing the draft leaves `main` unchanged. If eventually merged, record the actual merge SHA and use the section-9 reviewed targeted rollback; preserve all unrelated work.

**Data/API/privacy/cost/storage consequences of this investigation:** **none**. This section records observations and test evidence only; no application code, schema, APIs, browser storage, audio files, server configuration or production settings were changed.


## 14. Folder hierarchy from template separators only — 2026-10-26 12:15 UTC

### (1) Aim, observed defect, and evidence
The draft's existing `Tidy.tsx` built a folder with `formatTemplate(folderTpl, v).split("/").map(safeName).join("/")`. That splits **after** inserting canonical metadata. A real artist name such as `AC/DC` would be treated as two directories instead of one artist value. A blank album/year could produce `Example Artist/` or `Example Artist//`, which `safeName("")` converts to unintended `Untitled` folders. This is a deterministic source-level defect reproduced on Node 22.16.0 with a faithful isolated copy of the current formatter; not a browser incident or a Spotify import test.

### (2) Base, exact paths/functions/logic/why
PR #164 still targets `main` at **ec35a82c6f7d0f04c0c93e596ba3f7899223e603**. The change is appended to the **existing draft branch**, not main:
- `app/local/formatTemplate.ts`: add exported `formatFolderSegments(template, values)`, which splits only the **user template** on `/`, formats each segment independently, and drops segments left empty by missing values. It deliberately leaves metadata punctuation intact for existing filesystem sanitization.
- `app/local/Tidy.tsx`: import the new helper and replace `formatTemplate(folderTpl, v).split("/")` with `formatFolderSegments(folderTpl, v)` before the unchanged `.map(safeName).join("/")`. File naming, embedded tags, export writer and original files are untouched.
- `tests/local-format-template.test.mjs`: add five regression tests (now **17** total), covering canonical artist/album slashes, missing optional folder levels, repeated template delimiters, blank template and canonical punctuation.
- This handover section records the evidence, verification limits, impact and rollback.

Commits for this follow-up: **447ba1c98ec6bc760fa1c251534a815e717f4788**, **08d42e81e9b283195d3703bf66ae03cfe2d3ffec**, **55a6b1e5b153d111a20fa210ddc4263892cfce13**.

### (3) Before/after user behaviour
**Before:** `{artist}/{album}` with artist `AC/DC` and album `A/B` could create `AC/DC/A/B`, four folder levels rather than the two specified. Empty album/year levels could become `Untitled` directories.

**After (proposed):** Template separators alone create folder levels. `AC/DC` remains one raw segment and existing `safeName` produces `ACDC` (it removes filesystem-unsafe slashes), so the result is `ACDC/AB`, exactly two levels. Missing optional folder levels are skipped rather than creating `Untitled`. The preview and export use the same computed path. This does **not** preserve literal `/` in filesystem folder names.

### (4) Technical assumptions/dependencies/existing features
No new dependencies or libraries. Relies on existing `formatTemplate`, `safeName` and existing path preview/export plan. Slash in a **template** means a folder separator; slash in a **metadata value** is sanitized within one segment. The helper assumes template validation already runs before save. Existing presets, saved custom templates, metadata overrides, cover-art option, ZIP/folder fallback and duplicate filename handling remain. Review unusual path separators, long paths, and filesystem differences in a browser.

### (5) Data/API/privacy/cost/storage consequences
**Database migrations/writes:** none. **New APIs/permissions/requests:** none. **Audio upload:** none. **Original-file modification/deletion:** none. **Production settings/deployment:** none. **New browser-storage keys/migrations:** none; the existing custom template preferences remain unchanged. **Privacy/network/cost:** no additional data transmission or service cost. **Existing exports:** unchanged on disk; only future exported folder paths can differ. **Audio tags/artwork:** untouched by this change.

### (6) Tests actually run versus missing
- **Executed:** `node --experimental-strip-types --test /mnt/data/localcuts_review/folder-segments.test.mjs` against a faithful isolated reconstruction of the helper + seven targeted test cases → **7 passed, 0 failed** (Node.js 22.16.0). This is **not** the committed test suite or a full checkout.
- **Executed:** `tsc --noEmit --strict --target es2022 --module esnext --lib dom,es2022 /mnt/data/localcuts_review/formatTemplate.ts` → **exit 0** (isolated helper only, not the committed branch or Tidy integration).
- **Executed:** GitHub connector V8 harness loaded the **updated GitHub branch** `formatTemplate.ts` and all **17 committed test bodies**, stripped TypeScript annotations and Node imports, and ran them with minimal assert/test implementations → **17 passed, 0 failed**. This is not Node's actual test runner.
- **Executed:** GitHub connector V8 harness combined the updated GitHub helper with `safeName` extracted from **main** `app/local/write.ts`, checking six expected final folder paths → **6 passed, 0 failed**. This is not browser filesystem validation.
- **Not executed:** full checkout's `node --experimental-strip-types --test tests/local-format-template.test.mjs`, all other repository tests, `npm run lint`, `npm run build`, browser/real-audio integrity tests or Spotify Local Files imports. Container still cannot resolve github.com for a repository clone.
- **Vercel blocker:** the earlier first failure occurred after commit `5ae706393400` introduced the canonical-readiness `Tidy.tsx` integration. Exact deployment error logs remain inaccessible. At the time of this note, the latest commit's Vercel status was **pending**, not passing. Do not claim this follow-up fixes the deployment.

### (7) Edge cases/unresolved risks
- Canonical artist/album values with `/`, missing album/year, repeated template delimiters and empty template covered in focused tests; actual filesystem writes are untested.
- A literal slash in metadata is **removed by existing `safeName`**. This is deliberate filename sanitization, not a canonical metadata tag rewrite.
- Empty *metadata* segments are omitted. A segment containing only punctuation may still sanitize to `Untitled`; no broader sanitization change was attempted.
- Cross-platform path length, duplicate names, Unicode, parent-directory collisions, browser picker permissions and ZIP fallback need integration tests.
- PR #164's pre-existing Vercel failure and separate draft MP3/FLAC safety PRs #162/#163 remain unresolved.

### (8) Precise next steps for Claude/reviewer
1. Inspect current main and draft PR #164, verify these three commits and the exact diff; do not overwrite unrelated Claude work.
2. **Obtain Vercel build logs** for the first failing `5ae706393400` and the latest head. Fix the actual build error on this draft branch; the source-level change here is not proof of a fix.
3. Run `node --experimental-strip-types --test tests/local-format-template.test.mjs tests/local-canonical-ready.test.mjs`, existing Local Cuts tests, `npm run lint`, and `npm run build` in a real checkout. Record results.
4. Browser-test preview and folder/ZIP exports with `AC/DC`, `A/B`, missing year/album, literal template separators, manual overrides, invalid templates, duplicates and Unicode; compare source and output audio bytes and inspect tags/art.
5. Coordinate with #162/#163. Do **not** merge/deploy automatically. Once a human merges, record actual merge SHA in the cumulative recovery ledger via a separate documentation-only draft PR, reconciling existing #161.

### (9) Reversible rollback with actual merge SHA only
PR #164 is **still draft**; **no actual merge SHA exists**. Before merge, to remove only this folder-segment change, revert these three commits in reverse order on the draft branch (review the diff and handover impact), retaining the rest of #164. To remove the entire draft, close without merging. **After merge**, fetch the real merge SHA; for a two-parent merge use `git revert -m 1 <ACTUAL_MERGE_SHA>` on a **new review branch**; for squash/rebase identify the actual resulting commit(s). Preserve later changes and never reset or force-push main.

### (10) What must NOT be reverted/removed
Do **not** remove unrelated Claude edits, merged #157/#158/#159/#160, draft #161/#162/#163, the rest of #164's canonical metadata readiness and saved template work, archive or user data, production settings, originals or previously exported files. Never restore the entire `app/local` folder from an old commit.

## 15. Follow-up: verified Node test run and export-path audit (2026-10-26 13:12 UTC)

**Aim/evidence:** Prior updates relied mainly on isolated V8 execution, and the preview deployment is still failing. This run re-checked main (ec35a82c6f7d0f04c0c93e596ba3f7899223e603), open drafts #161–#164, the main recovery ledger, this branch, and the Vercel status. No new application changes were made: the highest-priority blocker remains the unexplained failed Vercel build.

**Exact source verification:** The following four files were copied into an isolated Node workspace at `/mnt/data/local-cuts-review` and their `git hash-object` SHA-1 hashes matched the GitHub blobs on this branch **exactly**:
- `app/local/formatTemplate.ts`: `f9a9c38d7c27a2aee35318ce1d90f59a74d3f0a7`
- `app/local/canonicalReady.ts`: `c8fd24d33993799f8a6a9ca1aa446dc4706887fd`
- `tests/local-format-template.test.mjs`: `eb94c11fb9aca3bcdabe99d21f0f2f7de1ac4451`
- `tests/local-canonical-ready.test.mjs`: `ace6d4bc66a1b3a8255bcbb8b893d7f43afc70f7`

**Tests actually RUN** on Node v22.16.0 and TypeScript 5.8.3, using exact matching helper/test files (not a full checkout):

~~~bash
cd /mnt/data/local-cuts-review
node --experimental-strip-types --test tests/local-format-template.test.mjs tests/local-canonical-ready.test.mjs
# 24 tests, 24 passed, 0 failed, 0 skipped
tsc --noEmit --strict --target es2022 --module esnext --lib dom,es2022 app/local/formatTemplate.ts app/local/canonicalReady.ts
# exit code 0 (isolated helper compilation)
~~~

An additional **three** isolated assertions using the main branch's exact `safeName()` expression verified `AC/DC` remains one sanitized folder segment (`ACDC`), `- Intro` remains a valid filename, and absent album/year do not create empty folder levels. These three assertions were executed but **not committed as regression tests**. A separate read-only reproduction confirmed a **pre-existing** extensionless-file issue in `Tidy.tsx::ext()`: `audio` is given `.mp3` without transcoding. This is an unresolved Spotify-compatibility risk, **not fixed in this PR**. `safeName("CON")` remains `CON`, a potential Windows reserved-name issue; this was also **not fixed**.

**Build blocker and missing verification:** GitHub's latest commit status for `edc33ed5d3cd038a009dc03f2d6461c1542acd1d` is `Vercel: failure` with deployment `dpl_E5v4Fnx3TNfQ5WcNPFg8AvCZijj8`. The public deployment URL was inaccessible and this environment cannot clone the repo (`Could not resolve host: github.com`). **No Vercel logs, full Next build, full lint, TSX integration, browser tests, real audio tag inspections or Spotify imports were executed.** Do not infer the deployment failure's cause from the test success. The first failing commit remains `5ae7063` per the prior investigation, but this is a correlation, not a diagnosis.

**Data/API/privacy/cost/storage consequences:** None. This follow-up modifies documentation only on the existing draft branch; it makes no application code, database, API, browser storage, export or original-audio changes and adds no dependencies or production settings.

**Precise Claude next steps:** Obtain Vercel logs with the deployment's suggested `npx vercel inspect dpl_E5v4Fnx3TNfQ5WcNPFg8AvCZijj8 --logs` under an authorized environment; identify a concrete failure before patching. Then run `npm run lint`, `npm run build`, all Local Cuts Node tests, and actual Chrome/Edge and Spotify Local Files import tests. Separately consider a narrowly scoped, reviewed extensionless-file safety fix and Windows reserved-path sanitization, without overwriting drafts #162/#163. Do not conflate filename-template success with Spotify compatibility.

**Rollback / preserve:** Draft #164 is still unmerged; close it to abandon its application changes, or selectively revert this documentation commit on the draft branch if needed. There is **no actual merge SHA** for #164. After any human merge, inspect GitHub's actual merge commit and follow section 9's reviewed revert procedure. Preserve unrelated Claude work, merged #157–#160, and other open drafts. Never delete original audio, user exports or server data.

## 16. Follow-up: preserve source audio extension (2026-10-26 14:07 UTC)

### (1) Aim and observed defect/evidence
The existing `Tidy.tsx::ext(name)` returned `.mp3` when a source filename had no recognized extension. `app/local/page.tsx::addFiles()` can accept an extensionless file when the browser supplies an `audio/*` MIME type. `tidiedCopy()` does **not** transcode audio: for such files it returns the original Blob unchanged. Therefore the prior export path could name unchanged, possibly non-MP3 bytes `*.mp3`, misleading users and Spotify. The earlier read-only review reproduced this from the source expression; it was a demonstrated code-path risk, not a confirmed real Spotify import failure.

### (2) Base/commits/changed paths and exact logic
**Base:** draft PR #164 remains based on `main` at `ec35a82c6f7d0f04c0c93e596ba3f7899223e603`; the main branch was rechecked this run and remains at that SHA. All changes were committed **only to existing draft branch** `feat/local-cuts-custom-export-templates-20261026`.
- `app/local/formatTemplate.ts` — commit `352274474177f57d2fc79fc3c545338ebefe773d`: add `sourceExtension(name)`, which returns a lowercased existing 2–5-character filename extension or the empty string, never an invented extension. It deliberately does not infer format from MIME, sniff bytes or transcode.
- `app/local/Tidy.tsx` — commit `6c9714ad40e598ac00cf18b21d0672a663f2f3fb`: import/use `sourceExtension` in the export path, remove the old `ext()` fallback, and show an explicit warning when connected source filenames lack an extension. The existing canonical tag/filename presets, override handling, file-copy pipeline and source files are unchanged.
- `tests/local-format-template.test.mjs` — commit `e67e91f815d69f6ff3fd82907f0d140e7b7bae73`: three additional focused regression cases (extensionless, common known extensions, and unsupported/long suffixes); the total formatting test count is now **20**.
- This handover section records the fix and limitations. No other application paths changed.

### (3) Before/after user behaviour
**Before:** an extensionless audio file imported through MIME detection could be exported as `Title.mp3` despite the unchanged source audio bytes. **After (proposed):** its exported filename is `Title` without a guessed extension, and the UI warns that Spotify may not recognize it. Known `.mp3`, `.flac`, `.m4a`, `.wav` etc. suffixes are preserved (lowercased) and bytes remain untouched by naming. This avoids falsely asserting MP3 compatibility; it does **not** convert unsupported audio into Spotify-compatible audio.

### (4) Technical assumptions/dependencies/existing features
This reuses the existing 2–5 ASCII-alphanumeric suffix detection and is intentionally narrower than a format-detection system. No new libraries, network services, audio parsers or browser APIs. It does not alter canonical matching, version confirmation, cover art, embedded tags, ZIP handling, custom template persistence or file-copy behaviour. Source extensions are inferred from the original filename only, not from content. A filename with an unrecognized long extension loses that suffix, as it already did before (but no longer acquires a fake `.mp3`). This must be reviewed for user expectations.

### (5) Data/API/privacy/cost/browser-storage consequences
**Database/schema migrations:** none. **Database writes:** none. **New or changed API requests/endpoints:** none. **Uploaded audio:** none. **Original audio edits/deletions:** none. **New browser storage keys or migrations:** none. **Privacy/security changes:** none identified. **Dependencies/server or third-party costs:** none. **Production settings/deployment:** none changed. Only the generated copy's name and an in-page warning change for extensionless recordings.

### (6) Tests actually executed vs not executed
- **Executed:** Retrieved the post-commit `app/local/formatTemplate.ts` and `tests/local-format-template.test.mjs` directly from GitHub branch; stripped TypeScript-only annotations and `node:test` imports; executed **all 20 committed test bodies** in the connector's V8 JavaScript environment with a minimal `test`/assert harness. Result: **20 passed, 0 failed**. GitHub blob SHAs: helper `96541b3097d80171c2f66a1c2045d58820a8b9b9`; tests `fd2adfe150b311ce962321d45ac2467b4caaf553`. This is **not** the Node test runner.
- **Executed:** Static source check of retrieved `Tidy.tsx` (blob `bbce42dac7c6b20a16d120f0018079a4a5543031`) confirmed the new import/use, removal of `ext()`, and presence of the extensionless warning. This is **not** a React/Next integration test.
- **Not executed:** full checkout's `node --experimental-strip-types --test tests/local-format-template.test.mjs tests/local-canonical-ready.test.mjs`, `npm run lint`, `npm run build`, TypeScript TSX integration, actual browser file picker/ZIP exports, binary-format decoding, or Spotify Local Files imports. The execution container's GitHub clone attempt failed DNS resolution (`Could not resolve host: github.com`). Earlier Node checks in section 15 apply to an older branch head and must not be attributed to this change.

### (7) Edge cases and unresolved risks
An extensionless `audio/mpeg` file may now lack a suffix that Spotify needs; this is intentional fail-safe behaviour rather than a conversion or automatic detection solution. Unsupported long extensions, dotfiles, Windows reserved names (`CON`, `AUX`, etc.), case-insensitive path collisions, duplicate names, MIME/content mismatch, and browser/Spotify format support remain to be investigated. The unchanged writer still does not transcode M4A/WAV/OGG. **Vercel build status remains a blocker**: the first failure began after `5ae7063`, but no build logs or verified root cause are available. Do not claim this fix resolves deployment.

### (8) Precise Claude/reviewer next steps
1. Review these three commits and their exact diff on draft #164, preserving other changes. Obtain Vercel logs for the first failing commit and the latest head; diagnose the actual build failure.
2. Run the two committed Node test files, all existing Local Cuts tests, `npm run lint`, `npm run build` in a real checkout; report failures honestly.
3. Import a real extensionless audio file with a reliable `audio/*` MIME type, inspect exported bytes versus source, verify the warning, and test Spotify Local Files detection. Also test mixed-case extensions, unsupported formats, ZIP/folder output and Windows reserved names.
4. Do not merge, deploy or touch production settings automatically. After any human merge, reconcile cumulative ledger `docs/local-cuts-claude-recovery.md` through the existing documentation-only draft #161 or a new docs-only draft if needed.

### (9) Reversible rollback, actual merge SHA only
PR #164 is **still draft**, so **no merge SHA exists**. To reverse only this follow-up before merge, selectively revert `e67e91f815d69f6ff3fd82907f0d140e7b7bae73`, `6c9714ad40e598ac00cf18b21d0672a663f2f3fb`, then `352274474177f57d2fc79fc3c545338ebefe773d` in reverse order on the draft branch, after reviewing the diff; remove this section from the handover accordingly. To abandon all of #164, close its draft without merging. **If merged later**, fetch its actual merge SHA: for a two-parent merge, `git revert -m 1 <ACTUAL_MERGE_SHA>` on a new review branch; for squash/rebase identify actual resulting commit(s) first. Do not guess a merge SHA or overwrite intervening edits.

### (10) Must NOT be reverted/removed
Preserve unrelated Claude work, all merged #157/#158/#159/#160 changes, other draft #161/#162/#163 work, the rest of #164's saved formatting and canonical metadata readiness changes, original audio, previously exported files, browser data, server catalogue and production settings. Never revert the whole `app/local` directory or force-push `main`.


## 17. Follow-up: collision-safe duplicate export names (2026-10-26 15:03 UTC)

### (1) Aim, observed defect and evidence
Read current `main` (`ec35a82c6f7d0f04c0c93e596ba3f7899223e603`), its recent commits, all open PRs (#105 and draft #161–#164), the main recovery ledger, and previous #164 handover sections before changing anything. No new PR was opened. Source inspection of `app/local/Tidy.tsx::save()` found an export-loop hang made more reachable by section 16's extensionless-file safety fix:

```ts
let path = p.path;
for (let k = 2; used.has(path.toLowerCase()); k++) path = p.path.replace(/(\\.[^.]+)$/, ` (${k})$1`);
```

For duplicate `Artist/Live` paths, the regular expression has no extension to replace. The path never changes and `used.has(...)` remains true, creating an unbounded synchronous loop and freezing export. The expression can also mistake a dot in a parent folder such as `Artist.v2/Live` for an extension and corrupt the intended folder structure. These are **demonstrated source-code failure modes**, not claims of a browser reproduction.

### (2) Base, exact commits/paths/functions/logic/why
**Base branch and commit:** `main` at `ec35a82c6f7d0f04c0c93e596ba3f7899223e603`. All writes were confined to the existing draft PR #164 branch `feat/local-cuts-custom-export-templates-20261026`; no writes to `main`.
- `60a0f56b40ca7fcbbad31403d25dd907fa6df2b4` — `app/local/formatTemplate.ts`: add `uniqueExportPath(path, used, extension)`. Return an unused path unchanged; otherwise split at the final folder slash, preserve the **actual source extension** supplied by the caller, and append ` (2)`, ` (3)`, etc. to the filename stem until a case-insensitive unused candidate is found. The loop now always produces a different candidate for each iteration, even for extensionless files and dotted song titles.
- `ef75c088cab02484cc93267cf16cd3fb8010da2e` — `app/local/Tidy.tsx`: replace the original inline duplicate-path loop inside `save()` with `uniqueExportPath(p.path, used, sourceExtension(p.item.name))`. Retain the existing `used.add(path.toLowerCase())`, folder picker/ZIP handling, and original audio-copy pipeline.
- `dacd8f3c1dc679b0883c17deb873b4a0cda373f9` — `tests/local-format-template.test.mjs`: import the helper and add five regression cases (extensionless duplicate, successive case-insensitive duplicates, dotted parent folder, dotted extensionless title, actual MP3/FLAC suffix preservation and distinct folders).
- This documentation update adds the complete review/recovery record. No other code paths were intentionally modified.

### (3) Before/after user behaviour
**Before:** importing two extensionless recordings that resolve to the same destination path can hang the page when exporting; dotted folder names can be misinterpreted by collision handling. **After (proposed):** the second copy is named `Live (2)`, the next `Live (3)`, and `Song.mp3` becomes `Song (2).mp3`. A dotted folder remains the same folder. File tags, audio bytes, metadata selections and the canonical-default/user-customized formatting policy do not change.

### (4) Technical assumptions, dependencies and effects on existing features
No new dependencies. The helper assumes `path` is already sanitized into slash-delimited folder segments and the `used` set contains lowercase paths, as established by `Tidy::save()`. It uses the **source** extension to avoid guessing whether a period in the canonical title is a format suffix. This changes only naming collisions within one export batch; it does not prevent overwriting a same-named file from a **previous** folder export. ZIP entries continue using the existing ZIP writer. No changes to match/version confirmation, metadata fetches, artwork, source files or MP3/FLAC tag writer. A very large number of collisions still incurs a linear scan.

### (5) Data, API, privacy, cost, storage and production consequences
**Database migrations/writes:** none. **API requests/endpoints:** none added or changed. **Audio upload:** none. **Original audio:** unchanged and never deleted. **Browser storage keys/preferences:** unchanged. **Privacy/security:** no new data access. **Dependencies/third-party costs:** none. **Production settings or manual deployment:** none. Exported *copy names* change only when a collision occurs. Existing generated files are not retroactively renamed or removed.

### (6) Tests ACTUALLY run, results and missing verification
A separate isolated workspace was assembled from GitHub-retrieved exact file contents at `/mnt/data/local-cuts-review`. `git hash-object` of the four copied files **exactly matched GitHub blob SHAs**:
- `app/local/formatTemplate.ts` — `ff5e0fde47af34989b0738cce888a0d3a6ce09a6`
- `tests/local-format-template.test.mjs` — `5070ea748caf0ec7c21f9c9e9e267246b6e07f1e`
- `app/local/canonicalReady.ts` — `c8fd24d33993799f8a6a9ca1aa446dc4706887fd`
- `tests/local-canonical-ready.test.mjs` — `ace6d4bc66a1b3a8255bcbb8b893d7f43afc70f7`

**Actually executed** with Node v22.16.0 and TypeScript 5.8.3:
```bash
cd /mnt/data/local-cuts-review
node --experimental-strip-types --test tests/local-format-template.test.mjs tests/local-canonical-ready.test.mjs
# 32 tests: 32 passed, 0 failed, 0 skipped
tsc --noEmit --strict --target es2022 --module esnext --lib dom,es2022 app/local/formatTemplate.ts app/local/canonicalReady.ts
# exit 0
```
A read-only GitHub check verified `Tidy.tsx` imports and calls `uniqueExportPath` and no longer contains the old loop. **Not executed:** full checkout `npm run lint`, `npm run build`, TSX/Next integration compilation, all other Local Cuts tests, real browser folder/ZIP export, audio inspection, Spotify import. The execution container cannot clone GitHub (DNS resolution failure). These helper checks do **not** establish that PR #164 builds or works in Spotify.

### (7) Edge cases and unresolved risks
The helper treats path collisions case-insensitively; actual filesystem case/Unicode normalization rules vary. Windows-reserved names (`CON`, `AUX`), maximum path lengths, duplicate existing files from prior exports, file picker permission failures, and user-visible collision previews (preview still shows the unsuffixed planned path) remain unresolved. Extensionless files may still not be accepted by Spotify; this change only prevents a freeze. Confirmed metadata and cover art still need real-browser validation. Latest GitHub Vercel status on commit `dacd8f3c` is **failure**; deployment ID `dpl_3i1ejJNVsFW2cnVCPbvA44HLLmsS`. Build logs are inaccessible in this environment; the root cause is unknown. Do not claim this change fixes it.

### (8) Precise next steps for Claude/reviewer
1. Inspect #164 diff and commits above, confirm `main` and other drafts have not changed, and review this handover.
2. Retrieve actual Vercel logs using authorized read-only inspection (`npx vercel inspect dpl_3i1ejJNVsFW2cnVCPbvA44HLLmsS --logs`) and identify the **actual** build failure before modifying integration code.
3. In a real checkout, run all Local Cuts tests, `npm run lint`, `npm run build`; report exact outcomes. Test browser export of duplicate extensionless names, repeated `.mp3` and `.flac`, dotted parent folders and dotted titles in both ZIP and folder modes; verify original bytes unchanged and compare output paths to previews.
4. Coordinate with draft MP3/FLAC safety PRs #162/#163. Do not merge/deploy without human review. After a human merge, record the **actual** merge SHA in `docs/local-cuts-claude-recovery.md` via a docs-only draft (reconcile existing #161 first).

### (9) Reversible rollback, actual merge SHA once merged
**PR #164 is still draft; no merge SHA exists.** To reverse only this follow-up before merge, selectively revert the three code/test commits **in reverse order** (`dacd8f3c`, `ef75c088`, `60a0f56b`) on its draft branch, review the resulting diff, and remove/update this handover section. To abandon all #164 changes, close the draft without merging. **After a human merge**, fetch the real merge SHA; for a two-parent merge, create a fresh review branch and use `git revert -m 1 <ACTUAL_MERGE_SHA>`; for squash/rebase identify actual resulting commits first. Inspect conflicts and preserve intervening work. Never force-push/reset `main`.

### (10) What must NOT be reverted/removed
Do not remove unrelated Claude code, merged #157/#158/#159/#160, open #161/#162/#163, other #164 formatting/canonical metadata improvements, original recordings, user exports, browser preferences, server collection/catalogue, or production settings. Never replace or revert the entire `app/local` directory. No other Claude work was intentionally touched.


## 18. Follow-up: scope canonical lookup failures to their request (2026-10-26 16:06 UTC)

### (1) Aim, observed defect and evidence
Rechecked `main` (still `ec35a82c6f7d0f04c0c93e596ba3f7899223e603`), recent commits, open PRs #105 and draft #161–#164, the cumulative main ledger, and prior #164 handover before editing. In `Tidy.tsx`, `metadataError` was a plain string and the canonical lookup effect called `setMetadataError(null)` synchronously. When a failed lookup was retried or the connected confirmed IDs changed, the previous failure could remain displayed until React ran the effect; this is a concrete stale-error UI path. Synchronous effect state updates may also be flagged by React Hooks lint rules, but **we have not established that this is the Vercel build failure**. GitHub reports Vercel failure on the pre-change head `3ffc078b75d6c362e6aecf5fa47996852ab7f29c`; actual deployment logs remain unavailable.

### (2) Base, changed paths/functions/logic/why and commits
**Base branch/commit:** `main` at `ec35a82c6f7d0f04c0c93e596ba3f7899223e603`. Updates were committed **only** to existing draft #164 branch `feat/local-cuts-custom-export-templates-20261026`:
- `app/local/Tidy.tsx` — `ea645d63adc82850a489073089a855237e36454a`: represent `metadataError` as a request-keyed object, derive `requestKey` from confirmed IDs and retry counter, display only `lookupErrorForRequest(metadataError, requestKey)`, and remove synchronous `setMetadataError(null)` calls from the metadata effect. Asynchronous completion still clears errors and populates `info`; failures are tagged with their originating request.
- `app/local/canonicalReady.ts` — `0faac56ef3ba20102ac9a303d4f25398bc96d5f9`: add `CanonicalLookupError` and pure `lookupErrorForRequest()` to reject stale failures.
- `tests/local-canonical-ready.test.mjs` — `c92cd15cb0d836be8aa7c70f5b84259954298da9`: add one regression case with four assertions for current request, retry, changed selection and null error.
- `docs/local-cuts-custom-templates-handover.md`: this section; no changes to other code paths. Review the actual PR diff before merge.

### (3) Before/after user behaviour
**Before:** a failed archive lookup could leave an old error visible while a retry or different confirmed selection started. **After (proposed):** errors are displayed only for the request that failed; retry/selection changes immediately hide stale messages, and a new failure displays the new error. Confirmed files still cannot export until their canonical metadata has loaded. The canonical defaults, user overrides, matching/version confirmation, cover selection, export naming, tagging and original-file handling are unchanged.

### (4) Technical assumptions/dependencies/effects
The request identity combines the existing joined confirmed-track IDs and explicit retry count. This is a UI error identity, not an audio fingerprint or a claim of recording identity. The async lookup already uses a cancellation flag; it continues to prevent superseded requests from writing results. No new libraries or services. `setInfo` and error clearing remain asynchronous after catalogue requests. There is no change to Supabase query shape or matching logic. The request-key helper is intentionally pure for isolated tests. Potential lint/build benefits are **hypotheses, not verified fixes**.

### (5) Data/API/privacy/cost/browser-storage consequences
**Schema/migrations/database writes:** none. **API endpoints or query shape:** unchanged; existing explicit retry can still make repeat catalogue reads, with the same possible query cost as before. **Audio upload/transcoding/original edits/deletions:** none. **New permissions/dependencies/external services:** none. **Browser storage keys/migrations:** none. **Privacy impact:** no new information collected or transmitted. **Production settings/deployment:** none changed. Only ephemeral React state and error presentation change; saved preferences and exported copies remain unaffected.

### (6) Tests actually run versus missing
**Executed:** In the connected GitHub tool's isolated V8 JavaScript runtime, fetched the exact post-commit `canonicalReady.ts` and `tests/local-canonical-ready.test.mjs`, extracted the three pure function bodies, removed the `Set<string>` TypeScript generic, and executed all eight committed test callbacks using a minimal synchronous `test` and assertion harness. **8 passed, 0 failed**. Also checked the retrieved `Tidy.tsx` source for request-key helper integration and removal of synchronous error-reset calls. Blob SHAs: `canonicalReady.ts` `8b5a8703ccc29f25a5f2137b66b15c8e1dd03528`; test file `63bdccb4f1099b7a2ef1e5bc4c625116a03a0dd6`; `Tidy.tsx` `107a7286a99215e0e66f8479e8e7f60af8005a4b`. **No shell command was run for these V8 tests**; this is NOT Node's test runner, a React render, TypeScript/TSX integration or a Next build.
**Not executed:** `node --experimental-strip-types --test tests/local-canonical-ready.test.mjs tests/local-format-template.test.mjs`, `npm run lint`, `npm run build`, full Local Cuts suite, browser selection/retry testing, actual MP3/FLAC exports or Spotify imports. A full checkout is unavailable because `git ls-remote` cannot resolve `github.com` in the execution container. Do not claim Vercel was fixed.

### (7) Edge cases and unresolved risks
The request key is built from confirmed IDs in their current order; a harmless reordering may cause an extra lookup/error dismissal, but does not bypass the canonical export gate. A retry of a failed request must hide the old error and either succeed or show a fresh error. Stale async responses are guarded by cancellation; browser race testing remains outstanding. An unrelated React Hooks lint rule or a TypeScript/Next error may still be causing Vercel failure. Earlier known risks (Windows reserved filenames, existing prior-export overwrite, codec support and artwork CORS) remain unresolved.

### (8) Precise next steps for Claude/reviewer
1. Obtain authorized Vercel logs for the latest failed deployment using its GitHub status link / suggested `npx vercel inspect <deployment-id> --logs`; confirm the real error rather than attributing it to this patch.
2. Run **actual** Node tests and `npm run lint`, `npm run build` in a full checkout. Inspect the React Hooks lint output for `Tidy.tsx` and address any concrete failure.
3. Browser-test a failing canonical lookup, retry, changing confirmed selections, unmounting mid-request, successful completion and export disabled/enabled states. Ensure original audio is never modified.
4. Review draft #162/#163 alongside #164 before any human merge; preserve unrelated work. If merged, update the cumulative recovery ledger in a **documentation-only draft PR** (reconcile existing #161) with the **actual** merge SHA.

### (9) Reversible rollback and actual merge SHA
**Draft #164 is not merged; no merge SHA exists.** To undo only this follow-up, on its draft branch selectively revert `c92cd15cb0d836be8aa7c70f5b84259954298da9`, `0faac56ef3ba20102ac9a303d4f25398bc96d5f9`, then `ea645d63adc82850a489073089a855237e36454a` in reverse order after inspecting later commits, and update this handover. To abandon the whole PR, close the draft without merging. **After a human merge**, fetch the actual merge SHA and use a reviewed `git revert -m 1 <ACTUAL_MERGE_SHA>` only if it is a two-parent merge; for squash/rebase identify actual resulting commits. Never invent a merge SHA, force-push or reset main.

### (10) What must NOT be reverted/removed
Preserve unrelated Claude changes, merged #157–#160, draft #161–#163, other #164 formatting and metadata readiness work, the catalogue, production settings, existing exports, saved browser data and original audio. Never restore `Tidy.tsx` or the entire `app/local` directory wholesale from an old snapshot.


## 19. Windows-reserved output path segments (26 October 2026)

**Aim/evidence:** Existing `safeName()` removes invalid punctuation but leaves reserved Windows device basenames (CON, PRN, AUX, NUL, COM1–COM9, LPT1–LPT9), including names with extensions. A custom `{title}` or `{artist}` export can therefore fail when written or extracted on Windows. This is a filename issue, not a canonical track identification issue.

**Base and changes:** Draft #164 branch `feat/local-cuts-custom-export-templates-20261026`, based on main `ec35a82c6f7d0f04c0c93e596ba3f7899223e603`. In `app/local/formatTemplate.ts`, add `safeExportSegment` that prefixes an underscore to reserved device names, including extension-bearing names. In `app/local/Tidy.tsx`, apply it after `safeName` to each folder segment and to the completed filename, preserving the actual audio extension. In `tests/local-format-template.test.mjs`, add reserved and non-reserved cases. No unrelated files or original audio touched.

**Before/after:** Previously an export named `CON.mp3` or an artist folder `NUL` could fail on Windows. Now its exported path becomes `_CON.mp3` or `_NUL`, while the canonical title/artist/album tags and user overrides remain unchanged. Canonical Static Cuts formatting remains default; user templates remain optional.

**Assumptions and consequences:** Browser-only string processing; no new dependencies, migrations, network/API calls, storage keys, data collection, privacy or cost effects. ZIP and directory paths both use the existing shared plan. This is not transcoding, nor proof of Spotify codec support. Windows may have further path restrictions (length, collisions with existing files), which are not addressed.

**Tests:** Added a Node regression case, but **not executed in a full repository checkout**. Run `node --experimental-strip-types --test tests/local-format-template.test.mjs` (or the project's supported TS-aware test command), `npm run lint`, `npm run build`, and browser-export actual files on Windows. Do not claim those passed. Earlier isolated tests are not proof of this patch.

**Risks/next steps:** Check current Vercel deployment logs for the persistent preview failure; verify `Tidy.tsx` compile and hook lint, Windows extraction, folder picker collision behaviour, existing export overwrites, and actual Spotify imports. If tests reveal reserved-name edge cases, amend only this helper and its call sites.

**Rollback:** Draft #164 is **unmerged**, so no merge SHA exists. Revert only the commit titled `Protect Windows-reserved Local Cuts export filenames` on the draft branch (inspect the actual commit SHA after creation), preserving all prior #164 changes. If #164 is later merged, record the actual merge SHA in the cumulative ledger and revert the relevant commit or reviewed merge using the correct parent strategy, never reset main.

**Do not remove:** Unrelated Claude work, merged #157–#160, draft #161–#163, other #164 canonical metadata and formatting work, original recordings, saved browser preferences or archive data.


## 20. Protect previous exports and make failed canonical artwork visible (26 October 2026, 17:00 UTC)

### (1) Aim and observed defect/evidence
Rechecked `main` at `ec35a82c6f7d0f04c0c93e596ba3f7899223e603`, recent commits, draft PRs #161–#164, open #105, the cumulative `docs/local-cuts-claude-recovery.md` ledger and prior #164 work. `Tidy.save()` previously opened a date-named folder with `getDirectoryHandle(name, { create: true })`; repeated exports on the same day reopened **the same folder** and `createWritable()` silently replaced any same-named previous export. Separately, `coverBytes()` swallowed artwork network/CORS failures, returned null and allowed a supposedly canonical Spotify-ready copy to be saved without the requested cover. These defects are directly visible in the prior source, not speculative deployment issues.

### (2) Base/branch, changed paths, functions, commits and rationale
**Base:** `main` `ec35a82c6f7d0f04c0c93e596ba3f7899223e603`. Work added **only to the existing draft #164** branch `feat/local-cuts-custom-export-templates-20261026`, no main writes:
- `app/local/formatTemplate.ts`: new `createUnusedExportDirectory(root, baseName)`, which checks for existing dated folders and creates the first available numbered sibling. Existing file-name conflicts are skipped, permission errors propagate. Commit `5926a3cb67d988253898d9950581fcf0478e380e`.
- `app/local/Tidy.tsx`: use that helper for directory-picker export instead of reopening the existing dated folder; on folder creation errors report failure without writing. If canonical artwork URL exists and cover art is enabled for a taggable file, a failed fetch now throws and fails that file rather than silently dropping artwork. CSV log includes the actual failure reason. Commit `65c23fbbe02e06f00b80356f3f4f0989faeb1283`.
- `tests/local-format-template.test.mjs`: add four asynchronous mock-directory regression tests for first export, same-day repeat, existing file occupying folder name, and permission errors. Commit `aa422f6a1e018055e100505d21eb33325d99ab49`.
- This documentation section. No unrelated application files changed.

### (3) Before/after user-visible behaviour
**Before:** choosing the same parent directory again on the same day could overwrite yesterday's already-exported copies if the dated folder was reused; broken artwork URLs/CORS produced silent no-cover exports. **After (proposed):** repeated exports create `Static Cuts YYYY-MM-DD (2)`, `(3)`, etc. instead of reusing a populated dated folder. An inaccessible requested cover causes that track's export to fail and appear in the changes CSV with a reason; users may retry or disable the cover-art option deliberately. Other tracks in the batch continue. The originals remain read-only. Canonical formatting, version confirmation, optional user overrides and ZIP output are unchanged.

### (4) Technical assumptions/dependencies and existing-feature effects
Uses browser File System Access `getDirectoryHandle`, `DOMException` `NotFoundError`/`TypeMismatchError` and existing React state; no new dependency. Chrome/Edge directory picker still requires user interaction. The helper probes up to 10,000 numbered names; after that it throws. The browser API lacks an atomic create-if-absent operation, so simultaneous tabs/processes racing to create the same folder remain an edge case. The fix applies to directory picker only; ZIP download behaviour is unchanged. For artwork, only files that `canTag()` and have a nonempty selected canonical cover URL are affected; files without a catalogue cover or unsupported tagging formats remain as before. Cover URLs may be remote and fail due to CORS/network; failure is surfaced, not silently ignored.

### (5) Data/API/privacy/cost/browser storage consequences
**Database schema, migrations, reads/writes:** none changed. **New network/API calls:** none; the same artwork fetch is now treated as required when selected; retries across multiple tracks may reattempt failed cover downloads and consume additional bandwidth. **Original audio:** never edited, deleted, uploaded or transcoded. **Existing export copies:** protected from ordinary same-day repeat export overwrites; new uniquely named folders occupy additional disk space. **Browser localStorage keys/migrations:** none. **Privacy/data collection:** no new collection or telemetry. **Permissions:** uses existing directory picker permissions; no new browser permissions. **Production/deployment:** untouched.

### (6) Tests actually RUN, exact method/results and missing verification
**Executed:** fetched exact committed helper from GitHub and evaluated its body in the connected tool's isolated V8 JavaScript runtime after removing its TypeScript type annotations, using a `DOMException` shim and fake directory handles. Six focused checks passed: fresh folder, repeat export `(3)`, occupied file-name skip, permission denial propagation, source integration presence, and committed test-case presence. This was an isolated V8 evaluation, **NOT the actual Node test runner or repository integration**. No shell command was run for these checks.
**Written but NOT run in the real repository:** four async cases in `tests/local-format-template.test.mjs`.
**NOT run:** `node --experimental-strip-types --test tests/local-format-template.test.mjs`, `npm run lint`, `npm run build`, full tests, browser folder picker, real CORS/artwork failures, MP3/FLAC file inspection, ZIP extraction or Spotify Local Files import. GitHub commit `edfd0b657efc9390aca68513ab2eeb062adb8dd0` showed Vercel status **failure** with deployment ID `dpl_APpBhMN516WNca4is2PErNowW7ZC`; the separate successful `Vercel Preview Comments` check does **not** mean the app built. Do not claim this patch fixes that deployment.

### (7) Edge cases and unresolved risks
Browser directory race condition, filesystem quota, permission revocation, existing file vs directory name, very large batches and disk-full errors require browser tests. A failed cover URL can cause repeated attempts per file; the user may choose to disable covers, but the UI currently only reports a failed-count summary and CSV details, not an inline per-file error. Missing catalogue cover URLs are not rejected; non-MP3/FLAC formats are not retagged or transcoded. The existing full-build failure remains unresolved, as do broader match accuracy and version verification limits. This does not guarantee Spotify playback.

### (8) Exact Claude/reviewer next steps
1. Inspect current draft #164 diff and obtain actual Vercel deployment logs via its status URL or authorized `npx vercel inspect dpl_APpBhMN516WNca4is2PErNowW7ZC --logs`; fix confirmed build errors before merging.
2. In a real checkout run `node --experimental-strip-types --test tests/local-format-template.test.mjs tests/local-canonical-ready.test.mjs`, `npm run lint`, `npm run build`; record outputs.
3. On Chrome/Edge, choose the same parent folder twice with identical files, verify the second export uses `(2)` and the first export remains byte-for-byte intact; test a file occupying the dated folder name, cancellation and denied permissions.
4. Use an actual confirmed track with an inaccessible artwork URL; verify no silent coverless MP3/FLAC is produced, the CSV reports failure, retry works and opting out of covers allows export. Test actual valid artwork and Spotify imports with copies.
5. Review interaction with draft #162 MP3 and #163 FLAC safety PRs, preserve unrelated Claude changes. If a human merges #164, update the cumulative ledger through a documentation-only draft PR with the **real merge SHA**; reconcile #161 instead of duplicating it.

### (9) Reversible rollback with actual merge SHA when available
**PR #164 is still draft; no merge SHA exists.** To reverse only this follow-up before merge, on the draft branch selectively revert `aa422f6a1e018055e100505d21eb33325d99ab49`, `65c23fbbe02e06f00b80356f3f4f0989faeb1283`, `5926a3cb67d988253898d9950581fcf0478e380e` in reverse order after inspecting later commits; remove this handover section or update it. To abandon all #164 work, close the draft. **After a human merge**, fetch its actual merge SHA; for a two-parent merge create a review branch and use `git revert -m 1 <ACTUAL_MERGE_SHA>`, for squash/rebase identify actual commits first. Do not force-push/reset main or delete export folders.

### (10) What must NOT be reverted/removed
Do not remove unrelated Claude code, merged #157–#160, draft #161–#163, other #164 canonical matching/metadata/template work, original recordings, existing user exports, browser preferences, server-side collections or catalogue, production settings or other developers' changes. Never revert the entire `app/local` directory wholesale.


## 21. Reset stale tag overrides after manual track/version reassignment (26 October 2026, 18:00 UTC)

### (1) Aim, observed defect and evidence
At the start of this run, checked `main` at `ec35a82c6f7d0f04c0c93e596ba3f7899223e603`, recent commits, all open PRs (#105 and draft #161–#164), `docs/local-cuts-claude-recovery.md`, and the prior #164 handover. The existing `app/local/page.tsx::update()` reset `owned` on a track-ID change but retained `item.edit` (per-file title/artist/album/year overrides entered in Tidy). `app/local/Tidy.tsx` intentionally applies `item.edit` **after** canonical catalogue fields. Therefore choosing a different version or correcting a wrong track match could silently export the new recording with the **old track's manual title, artist, album or year**. This is demonstrated by the source flow, not a claimed real-user reproduction. The fix addresses wrong metadata after manual reassignment; it does not establish acoustic identity or automatically choose the right version.

### (2) Base/branch, exact paths, commits and logic
**Base:** `main` `ec35a82c6f7d0f04c0c93e596ba3f7899223e603`. All writes remain on the existing **draft #164** branch `feat/local-cuts-custom-export-templates-20261026`; nothing merged or deployed.
- `7bd41f2a932b0c71bed7f6ed5aa4b47b1b6878e1` — `app/local/canonicalReady.ts`: add pure generic `matchUpdatePatch(previous, patch)`. If a patch explicitly changes `track_id`, it returns the patch with `owned: false` and `edit: undefined`. Otherwise it returns the patch unchanged. This preserves the existing ownership reset and clears only overrides that were tied to the old match.
- `b490999f59a8d94e3ebdf49cfc2fd736399d3f7f` — `app/local/page.tsx`: import/use `matchUpdatePatch` inside `update()` in place of the inline ownership-only reassignment conditional. No change to the existing `setLocalFile` association reassignment or match-selection UI.
- `d77475527ed30c818b5126e46f81ce2236497d11` — `tests/local-canonical-ready.test.mjs`: add five regression cases covering version switch, clearing a match, same-ID confirmation, first assignment and unrelated updates.
- This section updates `docs/local-cuts-custom-templates-handover.md`. The PR now touches seven paths in total (the prior six plus `app/local/page.tsx`). No `write.ts` or matching RPC change.

### (3) Before/after user behaviour
**Before:** User edits a demo's title to a preferred label, later changes its match to the official release; the old demo title still overrides the official release's canonical title during export. **After (proposed):** a changed track/version ID resets the previous manual tag overrides, so the newly confirmed track's canonical fields are used by default. The user can reapply intentional overrides in Tidy. Simply confirming a suggestion, changing status or choosing the **same** track ID retains existing overrides. Clearing the match also clears stale overrides; source file tags remain available as the local fallback. Ownership is still reset on track-ID change.

### (4) Technical assumptions, dependencies and existing-feature effects
No new dependencies, imports outside `app/local`, database changes, RPC modifications, acoustic fingerprinting, metadata network requests, audio writer changes, file copies or new UI controls. Assumes `track_id` uniquely identifies a catalogue recording/version; a changed ID is a material change of canonical metadata source. `edit` is per-file browser state and is not separately keyed by track ID. This intentionally sacrifices old manual overrides **only when a different match is chosen** to prevent accidental metadata contamination. Other fields (local source tags, file identity, match title/artist, reason and association updates) continue to use the existing logic.

### (5) Data/API/privacy/cost/browser-storage consequences
**Database migrations/reads/writes:** none. **New APIs/network calls:** none. **Costs/external services/dependencies:** none. **Uploaded audio, originals, previous exports:** no changes, writes or deletion. **Browser storage:** the existing `static_cuts_local_cuts` key is used; when a user changes a track/version match, previously saved `edit` overrides for that item are cleared on the next normal save. No new keys, migrations or bulk reset. **Privacy/permissions/production settings:** unchanged. This is a user-visible loss of prior manual override values on intentional reassignment; users can reenter them if desired. No effect on `static_cuts_tidy_prefs` custom template preferences.

### (6) Tests actually executed vs missing
**Executed:** Fetched the exact post-commit `app/local/canonicalReady.ts` (GitHub blob `137d021a557700a078be349a8d2c7f34a80b9039`) and `tests/local-canonical-ready.test.mjs` (blob `56d745ec7ee84d201823e3f8a31020d2acb0b2f9`). Removed TypeScript-only annotations and Node import lines **in memory**, then executed all **13 committed synchronous test callbacks** (8 existing + 5 new) using a minimal assertion harness in the connected tool's isolated V8 runtime. **13 passed, 0 failed**. The first harness attempt stopped before execution due to an overbroad validation check that matched a comment; corrected the harness and ran the 13 cases successfully. No shell command was used for these V8 checks.
**Not executed:** the actual Node `node --experimental-strip-types --test tests/local-canonical-ready.test.mjs`, `tsc` of the complete project, `npm run lint`, `npm run build`, React browser flow, real file retagging, Spotify imports or end-to-end user testing. The execution container again could not resolve `github.com` for `git ls-remote`. Isolated V8 success is not full TypeScript/Next integration verification.

### (7) Edge cases, blockers and unresolved risks
- `track_id: null` or a new ID intentionally clears edits; a patch without `track_id` or with the same ID does not. Check actual browser persistence and that `FixMatch` sends the intended ID.
- If the same recording has duplicate catalogue IDs, switching IDs still clears overrides; conservative canonical safety is intentional.
- The preexisting match suggestion can still choose the wrong version; every automatic match must be manually reviewed. No acoustic verification.
- The **Vercel deployment status remains failing** for the prior branch head `f57bf48f876106a74782a1598d9356e911e6a771` (GitHub status dated 2026-10-26 17:02 UTC, deployment `dpl_CQpHiLehb6ic2V4MF6WdkZUAJ6YW`). Main and draft #162/#163 had successful Vercel statuses. The first confirmed failed build on this branch was `5ae706393400ba5ef786ba16e7897ebe48b109f2`, following successful `64fe9a4ac76dcba1ad37ce8117adf5769c51a7bf`; it introduced the canonical-readiness effect. Actual build logs are **not available**, so the root cause remains unknown. Do not assert this reassignment patch fixes it or that the draft is merge-ready.

### (8) Precise next steps for Claude/reviewer
1. Review the three code/test commits above, the current seven-file #164 diff and latest Vercel status. Preserve all existing #164 custom templates, canonical readiness, repeat-export and artwork fixes.
2. Obtain **actual** Vercel logs for the first failing `5ae7063` and latest head; distinguish React Hooks lint, TypeScript compilation, missing dependencies and deployment configuration. Fix only a demonstrated cause.
3. In a real checkout, run `node --experimental-strip-types --test tests/local-canonical-ready.test.mjs tests/local-format-template.test.mjs`, other Local Cuts tests, `npm run lint`, `npm run build`; record exact output. Check that the generic `matchUpdatePatch` infers `Item` cleanly in `page.tsx`.
4. Browser-test edit demo tags → choose official version → Tidy preview/export canonical fields; repeat same-ID confirmation and check overrides persist. Inspect real MP3/FLAC output tags, source-file integrity and Spotify import with copies. Test browser reload and clearing a match.
5. Coordinate review with draft #162/#163 writer safety PRs. Do not merge/deploy automatically. If human-merged, update cumulative recovery ledger through a **documentation-only draft PR**, recording the **actual** merge SHA and respecting existing #161.

### (9) Reversible rollback with actual merge SHA
**Draft #164 is unmerged; no merge SHA exists.** To reverse only this follow-up on its draft branch, selectively revert `d77475527ed30c818b5126e46f81ce2236497d11`, then `b490999f59a8d94e3ebdf49cfc2fd736399d3f7f`, then `7bd41f2a932b0c71bed7f6ed5aa4b47b1b6878e1` in reverse chronological order, after inspecting intervening commits; update this handover. To abandon all #164 work, close the draft. **After merge**, fetch the real merge commit SHA. For a normal two-parent merge, open a new review branch and `git revert -m 1 <ACTUAL_MERGE_SHA>`; for squash/rebase, identify the actual commit(s). Never reset or force-push main; preserve later unrelated changes.

### (10) What must NOT be reverted/removed
Do not remove unrelated Claude code, merged #157–#160, other draft #161–#163 changes, the existing #164 canonical metadata readiness, custom templates, ZIP/folder export safety, artwork handling, source audio, browser preference templates, saved catalogue, user collections or production configuration. Never replace the entire `app/local/page.tsx`, `Tidy.tsx` or `app/local` directory with an old snapshot.


## 22. Validate canonical artwork bytes before writing MP3/FLAC covers (26 October 2026, ~19:00 UTC)

### (1) Aim and observed defect/evidence
Inspected current `main` (`ec35a82c6f7d0f04c0c93e596ba3f7899223e603`), recent commits, open PRs (#105 and draft #161–#164), cumulative ledger `docs/local-cuts-claude-recovery.md`, and earlier automated-run sections of this handover before editing. On draft #164, `app/local/Tidy.tsx::coverBytes` trusted the HTTP `Content-Type` header (or assumed `image/jpeg` if absent) and embedded any successful response bytes. A cover URL returning a 200 HTML login/error page, a wrongly labelled image, or an unsupported format could therefore be embedded as corrupt album artwork in exported MP3/FLAC copies. No real user reproduction is claimed; this is evidenced by the source logic.

### (2) Base, branch, exact paths/functions, commits, why
**Base:** unchanged `main` at `ec35a82c6f7d0f04c0c93e596ba3f7899223e603`. **Working branch:** existing draft #164, `feat/local-cuts-custom-export-templates-20261026`. No writes to main, merges or deployments.
- `4da066683dc1fd38dd7581db906fd8e4566aec90` adds `app/local/artwork.ts`, exporting `canonicalArtworkMime(bytes)` and `MAX_COVER_BYTES` (10 MiB). Recognizes JPEG and PNG from magic bytes; rejects HTML/empty/WebP/unknown content and images larger than the limit.
- `735dd4732960f05c405bc36acabb1173f1da1d99` updates `app/local/Tidy.tsx::coverBytes` to precheck a declared HTTP Content-Length when exposed, check actual downloaded bytes, derive APIC/FLAC MIME from those bytes instead of trusting HTTP Content-Type, and include a reason in the per-track failure CSV. It preserves the existing cache, CORS fetch, retry and cover-art opt-out.
- `08d3f9ace2b079f406cc994080c9585074322de2` adds `tests/local-artwork.test.mjs` with five focused regression cases. This section documents the changes; no other application path is changed by this follow-up.

### (3) Before/after user behaviour
**Before:** a 200 HTML page or a WebP image served as `image/jpeg` could be embedded as fake/corrupt artwork; very large artwork could be accepted without a size policy. **After (proposed):** JPEG/PNG magic bytes determine the stored image MIME, regardless of the response header; unsupported, empty or >10 MiB artwork causes **only that recording's export to fail** and logs a reason in the changes CSV. Other batch items continue; users may retry or explicitly turn off cover art. A catalogue track without any cover URL remains exportable without art, as before. No changes to canonical title, artist, version, album or filename customization.

### (4) Technical assumptions/dependencies/existing-feature effects
JPEG and PNG are the conservative artwork formats for local-file tags; this intentionally rejects WebP/GIF/AVIF rather than embedding formats with uncertain Spotify support. Magic bytes verify type, **not** full image decodability, dimensions, corruption after the header, or actual Spotify display. HTTP Content-Length may be absent/hidden by CORS, so the post-download byte-length check is authoritative; an unadvertised oversized response may still consume memory before rejection. No transcoding or image conversion is attempted. No new dependency. The writer and source audio are unchanged; only the pre-write cover input is validated. A previously accepted WebP cover now fails unless the catalogue artwork is replaced with JPEG/PNG or the user opts out of covers.

### (5) Data, API, privacy, cost, browser-storage consequences
**Database schema/migrations/reads/writes:** none. **New network/API calls:** none; same existing CORS fetch, with an extra inspection of response headers and bytes. **Network/data costs:** large responses may still be downloaded if Content-Length is unavailable; rejected art may be re-fetched on retry. **Browser localStorage/keys/migrations:** none. **Privacy/telemetry/uploads:** none. **Original audio:** not altered or uploaded. **Previously exported copies:** not changed or deleted. **New exported copies:** corrupt/unsupported artwork is blocked on a per-file basis rather than written; folder/ZIP paths and all other tags are unchanged. **Permissions/production:** no change.

### (6) Tests actually RUN versus written/unverified
**Actually executed** in the local container with Node v22.16.0: `cd /mnt/data/localcuts-check && node --experimental-strip-types --test tests/local-artwork.test.mjs`, on locally reconstructed **exact intended helper and test contents** (not a full GitHub checkout). **5 tests passed, 0 failed**: JPEG, PNG, HTML/empty, unsupported WebP, and 10 MiB rejection. This is a real Node test-runner execution on the reconstructed two files, **NOT** execution from the actual repository checkout, not a full TypeScript compile, and not integration with `Tidy.tsx`. The same helper and tests were then committed to the draft branch. **Not run:** actual repository `node --experimental-strip-types --test tests/local-artwork.test.mjs`, all Local Cuts tests, `npm run lint`, `npm run build`, browser CORS/downloads, real tag inspection, or Spotify Local Files import. The container cannot resolve github.com to clone the repo; do not overstate verification.

### (7) Edge cases and unresolved risks
- Header-only magic-byte checks cannot prove a complete image; malformed JPEG/PNG bodies could still fail in players. MIME whitelist intentionally rejects WebP/AVIF/GIF; no conversion is provided.
- A missing Content-Length means the browser buffers the response before size validation; large remote responses can still be costly. The 10 MiB limit is a policy choice requiring real-cover testing.
- Existing coverless catalogue entries remain coverless, and untagged source formats are still copied/renamed rather than transcoded.
- **Blocking existing problem:** draft #164's latest pre-change commit `cb582f52107599e7f77349e3f433af4840f78e45` had **failed Vercel status** at 2026-10-26 18:03:48 UTC, deployment `dpl_9wyo7aZAnuiQZai2wc7PFM4eSyf7`. Only the separate `Vercel Preview Comments` check passed. The actual Vercel logs remain inaccessible; the status alone does not reveal the root cause. Earlier first failing commit `5ae706393400ba5ef786ba16e7897ebe48b109f2` added canonical-readiness effect logic; subsequent edits have not demonstrably resolved the failure. This artwork patch is **not** claimed to fix the build.

### (8) Precise Claude/reviewer next steps
1. Fetch the current #164 diff and **actual** latest Vercel deployment logs using authorized access; identify and fix a demonstrated TypeScript/Next/runtime/build problem before considering merge. Do not assume artwork validation fixed it.
2. Run in a real checkout: `node --experimental-strip-types --test tests/local-artwork.test.mjs tests/local-canonical-ready.test.mjs tests/local-format-template.test.mjs`, then all Local Cuts tests, `npm run lint` and `npm run build`. Record commands/results.
3. Browser-test confirmed catalogue tracks with valid JPEG/PNG, wrong Content-Type, 200 HTML, WebP/AVIF, oversized image, CORS failure, absent cover, and cover-art opt-out. Confirm per-track failure CSV and that other tracks continue.
4. Inspect real exported MP3/FLAC image MIME and bytes, compare original audio hashes, and import exported copies into Spotify Local Files. Coordinate with draft #162/#163 MP3/FLAC bounds PRs.
5. If human-merged, add real merge SHA and exact rollback to the cumulative recovery ledger via a documentation-only draft PR, reconciling #161 rather than duplicating it.

### (9) Reversible rollback, merge SHA
**#164 remains draft and unmerged; no merge SHA exists.** To remove only this artwork follow-up on the draft branch, inspect intervening commits and selectively revert `08d3f9ace2b079f406cc994080c9585074322de2`, then `735dd4732960f05c405bc36acabb1173f1da1d99`, then `4da066683dc1fd38dd7581db906fd8e4566aec90`; update this handover accordingly. After a human merge, fetch the actual merge SHA: use a review branch and `git revert -m 1 <ACTUAL_MERGE_SHA>` only for a normal two-parent merge; handle squash/rebase according to actual commits. Never reset/force-push main, delete original files, or remove unrelated changes.

### (10) What must NOT be reverted/removed
Preserve unrelated Claude changes, merged #157–#160, draft #161–#163, all earlier #164 canonical metadata and matching work, custom templates, folder collision avoidance, existing cover-fetch failure handling, other app features, original audio, prior exports, local browser preferences, catalogue and collection data, and production settings. Do not replace the whole `Tidy.tsx` or `app/local` directory from an old snapshot.


## 23. Reconnected recordings must refresh the Spotify export plan (26 October 2026, ~21:06 UTC)

### (1) Aim and observed defect/evidence
Checked main `8a9de3f367588788204f0eaa996458d69498abfd`, recent merges #161–#163, open draft #164 and documentation draft #165, the cumulative recovery ledger on main, and this branch's earlier handovers before editing. Source review identified a real dependency defect (not a browser-reproduced incident): `app/local/page.tsx::addFiles` reconnects a remembered recording by mutating `files.current.set(key, file)` and calling `setTick`, without changing the `items` array when all files are already remembered. `app/local/Tidy.tsx::plan` was memoized on `[items, files, info, nameTpl, folderTpl, covers]`; the `files` Map retains its identity. Consequently, while Tidy remains mounted, reconnecting saved recordings can leave the preview empty/stale and the export button disabled despite connected audio. The issue existed on main and persisted in draft #164.

### (2) Base/branch, exact paths/functions/commits/why
- **Main inspected:** `8a9de3f367588788204f0eaa996458d69498abfd`; **original #164 base:** `ec35a82c6f7d0f04c0c93e596ba3f7899223e603`; **branch:** `feat/local-cuts-custom-export-templates-20261026`. The branch remains a **draft** and is not merged. Merged writer-safety #162/#163 must be preserved when reviewing the combined result.
- `37318391f4f126b1a76fb1377332b75eec2a5d02` adds `app/local/connectedFileSignature.ts::connectedFileSignature`. It computes an order-independent, length-prefixed signature from connected Map **keys only**. No file contents are read.
- `c34ecad63b2c909d4f6c44425e44661843094da8` adds `tests/local-reconnect-plan.test.mjs` with five signature regression cases.
- `faf796a206c6270bc2c80cdacf3e56d76b6078c1` updates `app/local/Tidy.tsx` to calculate `fileSignature` each render and include it in `plan`'s `useMemo` dependencies. `page.tsx` and all existing import/match logic are unchanged.
- This section documents the change; no new PR or production/main edit was created.

### (3) Before/after user behaviour
**Before:** On a fresh visit, remembered rows may be displayed without connected files. Re-selecting the same audio folder mutates the file Map and re-renders the parent, but the already-mounted Tidy preview may remain empty because its memo dependencies did not change. **After (proposed):** a reconnect changes the key signature and invalidates the memo; connected recordings should reappear in the export preview and become eligible for existing canonical metadata checks. The existing explicit match confirmation, custom overrides, non-destructive export and metadata readiness rules remain unchanged. This is a code-level expectation, **not yet browser-verified**.

### (4) Technical assumptions, dependencies, existing features
React re-renders the parent after `setTick`, as current `page.tsx` already does. The Map may be mutated in place; `connectedFileSignature` captures the connected key set. Sorting avoids spurious invalidations caused by insertion order, and length prefixes prevent separator ambiguity. The plan uses connected keys to decide which items are present, so replacing the File object under an unchanged key does not need to change the preview; the actual export still reads the current File object from the Map. Complexity per Tidy render is O(k log k) time and O(k) temporary memory for k connected keys. No new dependency, API or audio format logic.

### (5) Data/API/privacy/cost/browser-storage consequences
**Database/schema/migrations:** none. **Remote API calls:** none added; existing canonical metadata lookups may now become reachable when reconnected recordings correctly appear, under the existing confirmation rules. **Privacy/uploads/telemetry:** none added; signatures use local Map keys only and are not transmitted. **Network/paid service cost:** no new service or network cost. **Browser localStorage/IndexedDB/cookies:** no changes. **Original recordings:** never written to or deleted by this patch. **Existing exports:** untouched. **New exports:** only the preview's correct connected-file eligibility changes. **Production/deployment settings:** none.

### (6) Tests actually run versus written/unverified
**Actually executed:** Node v22.16.0 in an isolated local directory containing the exact intended helper and test source, **not a checkout of the GitHub repository**:

```bash
cd /mnt/data/localcuts-reconnect-check
node --experimental-strip-types --test tests/local-reconnect-plan.test.mjs
```

Result: **5 passed, 0 failed**. Cases: empty-to-connected Map mutation, same-count key replacement, insertion-order invariance, delimiter ambiguity avoidance, and same-key File replacement. After committing, fetched the actual helper, test and Tidy files from GitHub and verified the helper/test text and the new `fileSignature` dependency wiring. **Not run:** the tests from a full repository checkout, React component integration, full Local Cuts test suite, `npm run lint`, `npm run build`, browser reconnect/export, real MP3/FLAC inspection or Spotify Local Files import. The container cannot resolve github.com to clone the repo. These five helper tests **do not prove** that the UI or Vercel build works.

### (7) Edge cases, unresolved risks
A mutation without any subsequent React render cannot invalidate a React memo; the existing reconnect path explicitly calls `setTick`, but other future callers must also cause a render. Very large batches incur key sorting per Tidy render. File content changes under the same key are not reflected in the signature, intentionally: the preview depends on item metadata and key membership, not byte identity, and the writer uses the latest File reference. Browser reconnection and Spotify exports remain unverified. **The pre-existing Vercel failure on #164 is not diagnosed or fixed by this change**; obtain actual logs before merging. Do not infer a passing deployment from the helper tests.

### (8) Precise next steps for Claude/reviewer
1. Inspect the latest #164 diff and #165 merge-ledger draft; preserve merged #162/#163 writer protections. Obtain Vercel's **actual build logs** and resolve the demonstrated build failure, not a guessed cause.
2. From a real checkout, run `node --experimental-strip-types --test tests/local-reconnect-plan.test.mjs tests/local-canonical-ready.test.mjs tests/local-format-template.test.mjs tests/local-artwork.test.mjs`, then other Local Cuts tests, `npm run lint` and `npm run build`. Record exact outputs.
3. Browser test: import and confirm a recording, reload, observe remembered-but-disconnected rows, reconnect the same file while Tidy remains selected, verify the preview and export button update without switching tabs. Test a mixed connected/disconnected batch and same-count file swaps.
4. Verify canonical metadata/cover readiness, per-file overrides, source hashes, MP3/FLAC tags, and Spotify Local Files imports with **copies**. Do not merge/deploy automatically.
5. After any human merge, record the **actual** #164 merge SHA and rollback in `docs/local-cuts-claude-recovery.md` via a **documentation-only draft PR**, reconciling #165 if merged; never update main directly.

### (9) Reversible rollback and actual merge SHA
**No merge SHA exists: #164 is still a draft.** To undo only this follow-up before merge, on a reviewed branch selectively revert `faf796a206c6270bc2c80cdacf3e56d76b6078c1`, then `c34ecad63b2c909d4f6c44425e44661843094da8`, then `37318391f4f126b1a76fb1377332b75eec2a5d02` (reverse chronological order), after checking later changes; update this handover. To abandon all #164 work, close its draft. **After a human merge**, first obtain the actual merge SHA (not the branch-head SHA); use `git revert -m 1 <ACTUAL_MERGE_SHA>` on a new review branch only if GitHub confirms a normal two-parent merge. For squash/rebase, revert the actual commits. Do not reset or force-push main.

### (10) What must NOT be reverted or removed
Preserve unrelated Claude changes, merged #157–#163 (especially MP3/FLAC safety), the separate documentation draft #165, all earlier #164 custom template/canonical metadata/artwork/non-overwrite work, user overrides, existing browser preferences and saved matches, original audio, exported copies, catalogue and user collections, and production settings. Do not wholesale replace `app/local/Tidy.tsx`, `page.tsx` or the Local Cuts directory.
