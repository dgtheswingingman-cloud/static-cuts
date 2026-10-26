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
