# Claude handover — Local Cuts MP3 tag boundary guard

**Prepared:** 2026-10-26 UTC  
**Repository:** dgtheswingingman-cloud/static-cuts  
**Draft branch:** `fix/local-cuts-mp3-tag-bounds-20261026`  
**Base:** `main` at `ec35a82c6f7d0f04c0c93e596ba3f7899223e603` (merged ZIP PR #160)  
**Scope:** Narrow MP3 export safety fix for Spotify Local Files. No player work, no archive matching change. **Do not merge automatically.**

## 1. Aim and evidence

The pre-change `writeMp3()` trusted any source beginning with `ID3` and computed its audio start directly from four purported synchsafe size bytes. A corrupt header claiming a tag larger than the file could make `file.slice(start, end)` empty, yet the writer would still emit a new ID3 tag, producing a metadata-only output with no audio. It also added a purported 10-byte footer whenever flag 0x10 was set, although only ID3v2.4 defines that footer. This was identified by inspecting `app/local/write.ts` on main, not by a reported production incident.

## 2. Exact files and functions

- `app/local/write.ts`: added exported, side-effect-free `mp3AudioBounds(head, fileSize, tail)`. It checks supported ID3v2 major versions (2/3/4), complete 10-byte headers, synchsafe size bytes, valid retained audio range, and optionally removes ID3v1. The 10-byte footer is skipped only for v2.4 with footer flag. Invalid/truncated/tag-only inputs throw explicit errors instead of silently losing audio. Updated `writeMp3()` to read source head/tail, use validated bounds, then build the same new ID3v2.3 tag plus original audio slice. No other writers or ZIP code changed.
- `tests/local-mp3-export.test.mjs`: added seven regression tests for untagged audio and unchanged original, old ID3v2.3, ID3v2.4 footer plus ID3v1 tail, malformed synchsafe byte, tag size exceeding file, tag-only/truncated headers, and untagged range calculation.
- `docs/local-cuts-mp3-bounds-handover.md`: this detailed recovery guide.

No `app/local/Tidy.tsx`, `app/local/tags.ts`, matching, or canonical formatting rules changed.

## 3. Before / after user behaviour

**Before:** a malformed MP3 ID3 header could lead to a downloadable MP3 containing only freshly written metadata and no source audio. The v2.4 footer logic could also skip ten valid audio bytes on a malformed v2.3 flag.

**After (intended):** ordinary MP3 files retain their original audio payload and receive canonical/user-selected tags as before. Malformed ID3 size/version, a truncated header or an MP3 containing no bytes beyond its tags now fails that individual export rather than yielding an empty-audio copy. The existing Tidy export loop catches per-file errors, counts them as failed and continues other files. User originals are never written to.

This does **not** validate MP3 frame sync or guarantee the source audio is decodable, nor does it fix source files.

## 4. Dependencies, assumptions and compatibility

No new packages. Uses existing browser `Blob.slice()`, `Uint8Array`, and `File` interfaces. ID3v2.2, v2.3 and v2.4 have ten-byte headers and 28-bit synchsafe tag size fields; only v2.4 supports the optional footer. The helper validates boundaries, not the entire ID3 frame graph. The existing new tag remains ID3v2.3. Files with unsupported/invalid ID3 versions now fail closed rather than being retagged; that is an intentional conservative behaviour change. `tidiedCopy` dispatch for non-MP3 files remains unchanged.

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

**Written to the repository but NOT executed there:** `tests/local-mp3-export.test.mjs` (same seven scenarios, importing actual `app/local/write.ts`).

**Not run:** `node --experimental-strip-types --test tests/local-mp3-export.test.mjs`, existing local ZIP/identity/version tests, `npm run lint`, `npm run build`, TypeScript project check, browser tests, real music files, Spotify desktop/mobile Local Files import, artwork inspection. A standalone test is not evidence that the complete application builds or works with Spotify.

## 7. Edge cases, risks, known limitations

- Validation checks only ID3 header bounds and retained byte count. A file may still contain invalid MPEG audio, corrupt frames or unsupported encodings.
- A valid zero-length ID3 tag with zero audio now fails, as intended.
- ID3v2.4 footer detection trusts its version/flag; it does not independently validate footer signature.
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
4. Use **copies** of real tagged MP3s (ID3v2.3, v2.4, v1, no tags, broken headers) and compare exported audio payload and tags with independent tooling; then import exports into Spotify Local Files on supported clients.
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
