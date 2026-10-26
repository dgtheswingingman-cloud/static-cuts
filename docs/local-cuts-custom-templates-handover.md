# Claude handover — Local Cuts custom Spotify export layouts

**Prepared:** 2026-10-26 UTC
**Repository:** https://github.com/dgtheswingingman-cloud/static-cuts
**Branch:** feat/local-cuts-custom-export-templates-20261026
**PR:** [Draft PR #164 — saved custom filename and folder templates](https://github.com/dgtheswingingman-cloud/static-cuts/pull/164)
**Base:** main at **ec35a82c6f7d0f04c0c93e596ba3f7899223e603** (includes merged PR #160).
**Merge status:** NOT merged. Actual merge SHA is unknown until review/merge.
**Scope:** Local Cuts formatting UI only; no catalogue, matching RPC, audio writer or production settings changes.

## 1. Aim, observed limitation and evidence

The user confirmed canonical Static Cuts metadata must remain the default for confirmed recordings, with saved user-customizable formatting for Spotify Local Files exports. Inspection of main's app/local/Tidy.tsx showed only three hard-coded filename presets and three folder presets. The underlying renderer already supported several tokens, but users could not type a custom layout. The old renderer also silently dropped unknown {token} placeholders. This is source evidence, **not** a claimed customer incident.

This PR makes filename/folder templates editable and persistent **without changing canonical audio tags or the match-confirmation gate**. A standalone player is explicitly out of scope.

## 2. Base, exact changed paths, functions and why

| Path | Function/logic | Exact change and reason |
| --- | --- | --- |
| app/local/Tidy.tsx | Tidy() state and preference effects | Add customNameTpl, customFolderTpl, nameMode, folderMode, prefsReady; retain existing n/f/c keys and add cn/cf/nm/fm within static_cuts_tidy_prefs. Hydration guard prevents overwriting saved choices on initial mount. |
| app/local/Tidy.tsx | Filename/folder controls | Keep existing preset selectors; add Custom template… option, text inputs, token guidance, inline errors, and disable export for invalid templates. Switching to a preset retains the last custom layout. |
| app/local/Tidy.tsx | plan memo and save() | Replace local fill() with formatTemplate() for path previews/export; preserve safeName() segment sanitization and duplicate suffix logic; reject invalid templates before export. |
| app/local/formatTemplate.ts | templateError() | Reject unknown tokens, unmatched braces, control characters, >160-character templates, and blank filename templates; permit blank folder template. |
| app/local/formatTemplate.ts | formatTemplate() | Render {artist}, {title}, {album}, {year}, {track}; remove optional empty token wrappers and dangling template separators while preserving literal brackets, leading/trailing punctuation and spacing inside canonical metadata. The follow-up correction cleans only template text before restoring values. |
| tests/local-format-template.test.mjs | 12 test cases | Original nine cases plus regressions for canonical leading/trailing punctuation, canonical double spaces, and empty-template-field separator cleanup. |
| docs/local-cuts-custom-templates-handover.md | This handover | Evidence, compatibility, tests, risks, Claude next steps and reversible rollback. |

No other files are intended. Verify the PR file list/diff.

## 3. Before and after user behaviour

**Before:** Only Artist - Title, Title, 01 Title filenames; Artist / Album, Artist, all-in-one folders. Preset and cover-art preference saved locally.

**After:** Presets remain the defaults. User can select Custom template… and enter e.g. filename {track} - {title} [{year}] or folder {artist}/{album} - {year}. The existing preview shows resulting paths; custom choices persist in browser storage. Unknown placeholders visibly error and block export rather than silently disappearing. Existing per-track title/artist/album/year overrides remain available.

**Important:** Templates change exported filenames/directories **only**, not the tags embedded in audio. Confirmed matches continue to receive canonical archive metadata by default. Unconfirmed/unknown matches do not receive archive metadata. Original recordings remain untouched.

## 4. Technical assumptions, dependencies and existing-feature effects

- Uses existing React client state, localStorage, Tidy plan, safeName(), folder picker and ZIP export. **No new dependencies**.
- Formatting receives existing canonical-or-local values plus explicit per-track overrides. No new matching/version inference, artwork fetching, tagging logic or audio transformation.
- Existing extension detection and duplicate-path suffixes (2), (3) etc. are unchanged.
- Existing safeName() sanitizes forbidden filesystem characters per segment; / separates folders. Long/deep custom layouts and empty rendered components may still cause filesystem issues; browser test required.
- Saved n/f/c preferences remain readable. New mode/custom fields are additive; prefsReady gates writing until hydration finishes.
- Empty custom folder is equivalent to all-in-one; blank filename is blocked.
- MP3/FLAC are retagged by existing code; M4A/WAV/OGG remain rename/sort-only. Spotify codec support is **not** validated by this PR.

## 5. Data/API/privacy/cost/browser-storage consequences

**Database or schema migration:** none. **New APIs or requests:** none. **External services/AI:** none. **Server costs:** none. **Permissions:** none. **Uploaded audio:** none. **Original audio writes/deletions:** none. **Production settings:** unchanged. **Catalogue/ownership:** unchanged.

**Browser storage:** existing static_cuts_tidy_prefs key adds optional cn/cf (last custom layouts) and nm/fm (selection modes). Existing n/f/c meanings are preserved. Layouts are local to this browser and not synced. Existing reset removes the whole key. Existing static_cuts_local_cuts matched-item data is not migrated.

**Export copies:** Only file/folder names can change if user selects custom. Metadata writer, cover fetching and ZIP/folder output remain unchanged.

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
- Existing safeName() fallback Untitled can appear for empty folder segments. Preview shows it; filesystem reliability not proven.
- Existing folder-picker errors/permissions and ZIP fallback remain independent.
- formatTemplate() removes empty placeholder wrappers in templates while preserving literal brackets, punctuation and whitespace inside metadata values. **Existing safeName() still normalizes spaces and removes filesystem-unsafe characters in the final exported filename**; this follow-up only protects values inside the layout renderer. Test actual filename behaviour with real recordings.
- No artwork override UI, acoustic fingerprinting, custom embedded ID3 metadata template or automated recording identity proof.
- Draft PRs #162 and #163 modify app/local/write.ts. This PR intentionally does not touch that file; combined export behaviour still needs regression testing.

## 8. Precise next steps for Claude and verification

1. Inspect latest main, PRs #161/#162/#163 and this branch. Confirm base ec35a82c6f7d0f04c0c93e596ba3f7899223e603 and only the four paths above changed.
2. Run committed tests: node --experimental-strip-types --test tests/local-format-template.test.mjs, plus existing Local Cuts test suites.
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
