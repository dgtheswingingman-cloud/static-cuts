# Claude handover — Local Cuts MP3 tag boundary guard

**Prepared:** 2026-10-26 UTC  
**Repository:** dgtheswingingman-cloud/static-cuts  
**Draft branch:** `fix/local-cuts-mp3-tag-bounds-20261026`  
**Base:** `main` at `ec35a82c6f7d0f04c0c93e596ba3f7899223e603` (merged ZIP PR #160)  
**Scope:** Narrow MP3 export safety fix for Spotify Local Files. No player work, no archive matching change. **Do not merge automatically.**

## 1. Aim and evidence

The pre-change `writeMp3()` trusted any source beginning with `ID3` and computed its audio start directly from four purported synchsafe size bytes. A corrupt header claiming a tag larger than the file could make `file.slice(start, end)` empty, yet the writer would still emit a new ID3 tag, producing a metadata-only output with no audio. It also added a purported 10-byte footer whenever flag 0x10 was set, although only ID3v2.4 defines that footer. **Follow-up review found another data-loss path:** even for ID3v2.4, trusting the footer flag without checking the footer bytes can strip the first ten bytes of audio from a malformed file. This was identified by inspecting `app/local/write.ts` on main, not by a reported production incident.

## 2. Exact files and functions

- `app/local/write.ts`: added exported, side-effect-free `mp3AudioBounds(head, fileSize, tail, footerBytes)`. It checks supported ID3v2 major versions (2/3/4), complete 10-byte headers, synchsafe size bytes, valid retained audio range, and optionally removes ID3v1. The 10-byte footer is skipped only for v2.4 with footer flag **and a verified `3DI` footer whose version, flags and size match the original header**. `writeMp3()` reads only the expected 10-byte footer slice for this check. Invalid/truncated/tag-only inputs throw explicit errors instead of silently losing audio. Follow-up: both the helper and `writeMp3()` now recognise ID3v1 trailers at file sizes **greater than or equal to 128 bytes**, rejecting an exactly 128-byte ID3v1-only input. Updated `writeMp3()` to read source head/tail, use validated bounds, then build the same new ID3v2.3 tag plus original audio slice. No other writers or ZIP code changed.
- `tests/local-mp3-export.test.mjs`: added sixteen regression tests for untagged audio and unchanged original, old ID3v2.3, valid ID3v2.4 footer plus ID3v1 tail, missing or mismatched v2.4 footer, reserved v2.3 footer bit, malformed synchsafe byte, tag size exceeding file, tag-only/truncated headers, and untagged range calculation.
- `docs/local-cuts-mp3-bounds-handover.md`: this detailed recovery guide.

No `app/local/Tidy.tsx`, `app/local/tags.ts`, matching, or canonical formatting rules changed.

## 3. Before / after user behaviour

**Before:** a malformed MP3 ID3 header could lead to a downloadable MP3 containing only freshly written metadata and no source audio. The v2.4 footer logic could also skip ten valid audio bytes on a malformed v2.3 flag.

**After (intended):** ordinary MP3 files retain their original audio payload and receive canonical/user-selected tags as before. Malformed ID3 size/version, a truncated header, a claimed but missing/mismatched v2.4 footer, or an MP3 containing no bytes beyond its tags (including a 128-byte ID3v1-only file) now fails that individual export rather than yielding an empty-audio copy. The existing Tidy export loop catches per-file errors, counts them as failed and continues other files. User originals are never written to.

This does **not** validate MP3 frame sync or guarantee the source audio is decodable, nor does it fix source files.

## 4. Dependencies, assumptions and compatibility

No new packages. Uses existing browser `Blob.slice()`, `Uint8Array`, and `File` interfaces. ID3v2.2, v2.3 and v2.4 have ten-byte headers and 28-bit synchsafe tag size fields; only v2.4 supports the optional footer. The helper validates boundaries and a declared v2.4 footer signature/header agreement, not the entire ID3 frame graph. The existing new tag remains ID3v2.3. Files with unsupported/invalid ID3 versions now fail closed rather than being retagged; that is an intentional conservative behaviour change. `tidiedCopy` dispatch for non-MP3 files remains unchanged.

## 5. Data, API, privacy, storage, cost

- Database/schema/migrations: **none**.
- API/network requests and external services: **none** added.
- Secrets/auth/permissions: **none**.
- Browser localStorage, IndexedDB or caches: **none** changed.
- Audio originals: **never modified**; `tidiedCopy()` constructs a new Blob.
- Cost/billing/dependencies: **none** added.
- Exported audio: safer failure on malformed input; successful outputs still contain a fresh ID3v2.3 header and retained source audio slice.

## 6. Actual verification, separated from pending work

**Executed in an isolated Node 22.16.0 reproduction** (not a full repository checkout): `node --test /mnt/data/localcuts_mp3_check/test.mjs`. Result: **7 tests passed, 0 failed**. The reproduction copied the revised `mp3AudioBounds` and `writeMp3` logic and the relevant existing ID3v2.3 frame builder into a standalone JS module. Synthetic in-memory `File`/audio bytes were used. It verified retention of sample audio and original input, old-tag removal, and rejection of malformed bounds.

**Written to the repository but NOT executed there:** `tests/local-mp3-export.test.mjs` (now sixteen scenarios, importing actual `app/local/write.ts`).

**Additional review verification (2026-10-26):** extracted the **actual updated `mp3AudioBounds` helper** from the draft branch via GitHub and executed its JavaScript body after removing only its TypeScript signature in the JavaScript tool runtime. **15/15 focused boundary assertions passed**: untagged short/long files, ID3v2.2/v2.3/v2.4 tags, verified/missing/mismatched/out-of-range v2.4 footers, reserved v2.3 flag, ID3v1 trailer, oversized/tag-only files, truncated header, unsupported version, and invalid synchsafe byte. This is **not** a full repository test or a test of `writeMp3()`'s file-slice call path. The earlier seven isolated end-to-end synthetic tests predate the footer-validation follow-up and were **not rerun**.

**Not run:** `node --experimental-strip-types --test tests/local-mp3-export.test.mjs`, existing local ZIP/identity/version tests, `npm run lint`, `npm run build`, TypeScript project check, browser tests, real music files, Spotify desktop/mobile Local Files import, artwork inspection. A standalone test is not evidence that the complete application builds or works with Spotify.

## 7. Edge cases, risks, known limitations

- Validation checks only ID3 header bounds and retained byte count. A file may still contain invalid MPEG audio, corrupt frames or unsupported encodings.
- A valid zero-length ID3 tag with zero audio now fails, as intended. A 128-byte ID3v1-only file also fails after the follow-up correction.
- A declared ID3v2.4 footer is now checked for the `3DI` signature and matching version/flags/size. This protects against a missing or mismatched footer, but does not prove the remainder of the tag is well-formed.
- A malformed v2.3 file using reserved flags is not exhaustively rejected; it does not skip a footer.
- A source with misleading `ID3` prefix that is not a real ID3 tag now fails closed.
- Existing `writeFlac()`, `makeZip()`, artwork fetching, M4A rename-only handling, canonical metadata lookup, and version confirmation were not changed or retested.
- Existing ZIP fallback catches errors and reports failed individual files; verify the displayed failure count in a real browser.

## 8. Exact next steps for Claude

1. Inspect current main, this draft branch, open PR #161 (recovery documentation) and other recent merges before reviewing; do not overwrite concurrent work.
2. Review the three-file diff; verify that only the MP3 bounds helper, `writeMp3` call site, new test and this handover were touched.
3. In a full checkout, run:
   ```bash
   node --experimental-strip-types --test tests/local-mp3-export.test.mjs
   node --experimental-strip-types --test tests/local-zip.test.mjs
   node --experimental-strip-types --test tests/local-file-identity.test.mjs
   node --experimental-strip-types --test tests/local-version-match.test.mjs
   npm run lint
   npm run build
   ```
4. Use **copies** of real tagged MP3s (ID3v2.3, v2.4 with valid/missing/incorrect footer, v1, no tags, broken headers) and compare exported audio payload and tags with independent tooling; then import exports into Spotify Local Files on supported clients.
5. Confirm per-file failures show clearly without deleting other output or touching originals. If anything fails, fix this draft branch and update this handover with actual evidence.
6. After **reviewed merge only**, record this PR number and **actual merge SHA** in a separate documentation-only draft PR updating `docs/local-cuts-claude-recovery.md`. PR #161 already proposes a ZIP/recovery update; avoid conflicting ledger edits.

## 9. Reversible rollback procedure

**Before merge:** close this draft PR; main and users' files remain unchanged.

**After merge:** inspect the actual merge SHA and parentage. Prefer GitHub's Revert action to create a **new reviewed PR**. For a confirmed two-parent merge commit:
```bash
git fetch origin
git switch main
git pull --ff-only
git switch -c revert/local-cuts-mp3-bounds
git show --no-patch --pretty=%P <THIS_PR_ACTUAL_MERGE_SHA>
git revert -m 1 <THIS_PR_ACTUAL_MERGE_SHA>
# Inspect diff, run tests/lint/build, push new branch and open a PR.
```
For a squash/single-parent commit use `git revert <ACTUAL_SQUASH_SHA>` (no `-m 1`). If later changes touch the same lines, use a targeted inverse patch after inspection; **never** reset/force-push main. Reverting this change returns the earlier, less safe ID3 size handling; consider a corrected forward fix instead. The actual merge SHA is **not yet known** because this PR is a draft.

## 10. Explicit preservation / non-goals

Do **not** remove or revert unrelated Claude changes or Local Cuts work in merged PRs #157, #158, #159, #160 or open docs PR #161. Do not delete `app/local`, original recordings, previously exported files, user collections or database rows. Do not deploy, merge, force-push or modify production settings as part of this PR. This change does not implement automatic canonical formatting or user preference features; those remain the product priority and should be developed separately.

## 11. Follow-up review history (same draft PR)

- Branch commits `5c05c7ac8cc1594ef56d0252209e8e43e57cd0d3` and `62ad17c05348174464bcc1c904eb00e9075cbec7` strengthen the existing draft, **not** a new PR or main merge.
- The review identified that a forged or absent v2.4 footer could otherwise cause the first ten audio bytes to be skipped. Added `footerBytes` validation in `mp3AudioBounds`, a narrow 10-byte read in `writeMp3`, and three additional regression cases. The original v2.4 test now uses a real `3DI` footer rather than ten zero bytes.
- Authoritative reference: ID3v2.4.0 structure section 3.1/3.4, https://id3.org/id3v2.4.0-structure (size excludes the header and footer; footer identifier `3DI`).
- **No extra dependencies, database migrations, browser storage changes, network/API calls, cost, or modification of source recordings.** The additional read is a local 10-byte `Blob.slice` on v2.4 files declaring a footer.
- Rollback remains the draft-PR close or a future reviewed inverse PR for this PR's actual merge SHA, preserving #157–#161 and all unrelated Claude work. If only the footer verification must be undone after a merge, inspect later edits and revert just the two follow-up commits' hunks rather than resetting `main`.
- **Still required before merge:** execute all sixteen committed repository tests, lint/build, real-file audio-payload comparisons, and Spotify import tests. The 15/15 helper assertions are narrower evidence, not end-to-end validation.

## 12. Additional regression coverage and independent helper checks (2026-10-26)

- Added **five tests** to the existing `tests/local-mp3-export.test.mjs` (15 total): valid ID3v2.2, valid ID3v2.4 without a footer, declared v2.4 footer beyond EOF, unsupported ID3 version, and standalone ID3v1 trailer removal. No application source changed in this follow-up.
- Fetched the **actual `app/local/write.ts`** from this PR branch (blob SHA `bfd872bbee0a2f6b19649eb6de7c2503caa045d1`) and executed the unchanged `mp3AudioBounds` function body in a JavaScript V8 runtime after removing its TypeScript signature. **15/15 assertions passed, 0 failed.** This checks the helper only, not `writeMp3`, `tidiedCopy`, the repository's Node test suite or Spotify. The five newly committed tests were **written, not run** in the full repository.
- Attempted to access the repository from the local execution environment for real Node tests, but `git ls-remote` failed with `Could not resolve host: github.com`. Do not count this as a test pass or as a complete checkout.
- No new dependencies, API calls, database changes, storage changes, billing costs, privacy impact or original-file writes. Rollback is still close the draft PR before merge, or revert the actual merge commit via a reviewed inverse PR after verifying its parentage. Preserve all unrelated work and existing merged PRs.

## 13. Offline execution of all 15 committed test cases (2026-10-26 follow-up)

**Purpose:** Improve verification of the existing draft without creating another PR or changing application behaviour. Direct `git ls-remote https://github.com/dgtheswingingman-cloud/static-cuts.git HEAD` failed in the execution container with `Could not resolve host: github.com`; therefore a full Git checkout was **not** available.

**What was actually executed:** Fetched `tests/local-mp3-export.test.mjs` and `app/local/write.ts` from this exact draft branch using the connected GitHub API. Recreated the **15 committed test cases verbatim** in a local mirror at `/mnt/data/localcuts-pr162-review/tests/local-mp3-export.test.mjs`, alongside the MP3-related function implementations copied from `app/local/write.ts` (source blob SHA `bfd872bbee0a2f6b19649eb6de7c2503caa045d1`). The mirror intentionally **omits unrelated FLAC and ZIP code** and is not a full repository checkout; the tested MP3 code includes `mp3AudioBounds`, `writeMp3`, `id3v23`, `utf16Frame`, `apicFrame` and the MP3 `tidiedCopy` dispatch.

**Command actually run** (Node.js v22.16.0):

```bash
cd /mnt/data/localcuts-pr162-review
node --experimental-strip-types --test tests/local-mp3-export.test.mjs
```

**Result:** TAP reported **15 tests, 15 passed, 0 failed, 0 skipped** (duration 273 ms). The tests exercised synthetic `File` objects, the full MP3 retagging `Blob.slice` path, old ID3v2/ID3v1 removal, footer checks, rejection cases and source-byte retention. This is stronger evidence than the prior helper-only assertions, but **is not execution against a checked-out repository**, nor proof of production browser/Spotify compatibility. No real MP3 recordings or independent decoders were used.

**Remaining mandatory checks before review/merge:** Run the original test suite from a real checkout, compare the fetched mirror with the exact committed source, run existing ZIP/identity/version tests, lint, build and TypeScript checks, test real MP3s and Spotify Local Files on supported clients. The Vercel commit status reports success, but that alone does not prove any of those manual checks. This follow-up changes **documentation only**: no code, dependencies, database, browser storage, privacy, API, audio originals, production settings or operating cost impact.

**Separate investigation note (NOT changed by this PR):** `writeFlac()` in the same source file advances `p` by a metadata block's declared length without first verifying the full block fits within the loaded header or file. If a corrupted FLAC block length is larger than the actual file, it may produce an output with newly generated metadata but an empty original audio slice. This is a **code-inspection risk, not a reproduced real-file incident**. Address in a separate narrowly scoped, tested draft PR after MP3 review; do not broaden #162 without agreement. No change to rollback: close this draft before merge or revert its actual future merge SHA in a reviewed PR, preserving #157–#161 and all unrelated Claude changes.

## 14. ID3v1-only 128-byte regression correction (2026-10-26)

**Observed defect and evidence:** Inspection of the draft's actual `mp3AudioBounds` (previous source blob `bfd872bbee0a2f6b19649eb6de7c2503caa045d1`) showed that ID3v1 stripping required `fileSize > 128`, while `writeMp3` also only read the 128-byte trailer when `file.size > 128`. A synthetic file containing **exactly 128 bytes** beginning with `TAG` (the ID3v1 signature), and no MPEG audio, returned `{start: 0, end: 128}` instead of failing. This was **reproduced against the actual helper body fetched from GitHub** in the JavaScript V8 runtime, not inferred solely from the source. No real-world incident was reported.

**Exact changes on this same draft branch:** `app/local/write.ts`: change both ID3v1 checks from `> 128` to `>= 128` (one in `mp3AudioBounds`, one in `writeMp3`), so the trailer is read, removed and the resulting empty-audio range rejected. `tests/local-mp3-export.test.mjs`: add one `tidiedCopy()` regression case asserting rejection of the ID3v1-only file and preservation of the input bytes (**16 committed tests total**). Code commit `b6a03ff3c9164fc0a11b34fd04baac5133ef9e58`; test commit `698a8738856e1424442f1911990e471712fdeacd`. No other application functions, file paths, formatters, ZIP code, matching, UI or user preferences were changed in this follow-up.

**Before / after:** Before, the metadata-only 128-byte input could be exported as an MP3 with a new tag and no audio. After, it fails with `MP3 has no audio bytes after its tags; skipped export.` Ordinary 128-byte untagged data remains eligible; a file with an ID3v1 trailer and preceding data retains that preceding data. This still does **not** prove MPEG decodability or Spotify importability.

**Verification actually performed:** Re-fetched the updated branch source (blob `fa01a7f553ce9afa0de47268028939e516e26d03`) and the committed test file (blob `a68031d86038d2266d9fbc62ada6cc73602ee175`). Ran **six focused V8 assertions, all passed**, including actual-helper rejection of ID3v1-only input, 129-byte trailer handling, untagged 128-byte retention, short untagged retention, and source/test guard checks. Separately executed `node --test /mnt/data/localcuts-pr162-id3v1-focused.test.mjs` using Node.js v22.16.0: **3 passed, 0 failed**. The Node script is an **offline reconstruction** of the MP3 boundary and `Blob.slice` path with a stub new-tag builder, not the committed repository test file or a full checkout. The previously reported **15/15 offline mirror tests** are historical and **were not rerun** after this correction. The **new sixteenth committed test was written but has not been run in a full checkout**. Git clone still fails due to `Could not resolve host: github.com` in the execution container. No lint, full build, real audio file, browser or Spotify-client test was run.

**Assumptions and impact:** ID3v1 is a 128-byte trailer with `TAG` at its start; a file consisting only of that trailer has no audio to preserve. The implementation only checks tag boundaries, not MPEG frames. No database/schema/migration changes; no new APIs, network requests, third-party services, secrets, dependencies, permissions, localStorage/IndexedDB/caches, privacy/data upload, hosting/billing cost or production settings. Original audio is never overwritten; only exported copies are constructed. Existing per-file failure handling is expected to catch the rejection, but has **not** been manually verified in a browser.

**Next steps / review:** Review the exact two-line source change and one test against this draft branch; in a proper checkout run `node --experimental-strip-types --test tests/local-mp3-export.test.mjs` and the existing Local Cuts suites, `npm run lint`, `npm run build`; inspect actual MP3 and ID3v1-only fixtures with independent decoders and verify Spotify Local Files import. Check browser error reporting and originals. Also investigate the separate FLAC length-boundary risk without broadening this PR. The draft still has **no review approval** and must **not** be merged automatically.

**Reversible rollback:** Before merge, close draft PR #162; `main` remains unaffected. After a reviewed merge, inspect the **actual** merge SHA and parent count, then open a separate reviewed revert PR using `git revert -m 1 <ACTUAL_MERGE_SHA>` for a two-parent merge, or `git revert <ACTUAL_SQUASH_SHA>` for a squash; verify resulting diffs and tests. If only this follow-up is problematic, revert the two exact `>= 128` changes and the new test via a **targeted inverse patch** on a new branch, preserving the rest of #162 and subsequent edits. Do not force-push or reset main. The merge SHA is **not yet known**.

**Must preserve:** All unrelated Claude contributions and merged PRs #157–#160, open documentation PR #161, existing matching/version-confirmation/ZIP functionality, user files and exports, server collections, database rows, and any subsequent reviewed fixes. Update the cumulative ledger `docs/local-cuts-claude-recovery.md` through a **separate docs-only draft PR only after #162 is actually merged**, reconciling #161 and correcting stale merge status instead of blindly appending.
