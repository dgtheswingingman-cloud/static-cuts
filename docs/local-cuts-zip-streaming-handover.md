# Claude handover — Local Cuts ZIP export memory and ZIP32 limits

**Prepared:** 2026-10-25 UTC  
**Repo:** https://github.com/dgtheswingingman-cloud/static-cuts  
**Branch:** `fix/local-cuts-zip-streaming-20261025`  
**Draft PR:** [#160 — stream ZIP export and enforce ZIP32 limits](https://github.com/dgtheswingingman-cloud/static-cuts/pull/160)  
**Base:** `main` at `262d61a6a0c62274eb29c9092c13f46eee22cb04` (includes merged recovery PR #159).  
**Merge status:** Draft proposal; NOT merged, NOT production-deployed. The merge commit SHA is **not yet known**.  
**Ownership:** Changes on this branch are from the hourly ChatGPT Local Cuts development task; earlier PRs #157 and #158 are **not** part of this branch's diff.

## 1. Aim, defect and evidence

Local Cuts falls back to a browser-generated, uncompressed ZIP when the browser cannot save to a folder. In `app/local/write.ts`, the original `makeZip()` read **every audio Blob into a full-size Uint8Array** using `await e.blob.arrayBuffer()`, then retained that array in the output parts. That allocates an avoidable complete byte copy for each recording, potentially causing out-of-memory crashes on large folders. It also silently encoded 64-bit sizes and offsets into ZIP32's 32-bit fields with `le32`, risking invalid archives above ZIP32 limits. Finally, `app/local/Tidy.tsx` did not catch ZIP packaging errors, so the busy/progress state could remain stuck on failure.

These are defects visible in the pre-change source, **not** claims from reproduced end-user incidents.

## 2. Exact files, functions and why

| Path | Change | Rationale |
| --- | --- | --- |
| `app/local/write.ts` | Replace `crc32(Uint8Array)` with `crc32Blob(Blob)` reading `blob.stream().getReader()` in chunks. | Compute CRC without loading the entire recording in one ArrayBuffer. |
| `app/local/write.ts` | In `makeZip()`, append each original Blob as a Blob part instead of an entire copied Uint8Array. | Avoid one full-size copy per file; the ZIP is still assembled as a Blob. |
| `app/local/write.ts` | Preflight ZIP32 limits: at most 65,535 entries, UTF-8 filename <= 65,535 bytes, each file <= 0xffffffff bytes, entire ZIP <= 0xffffffff bytes. | Fail explicitly instead of emitting corrupt ZIP32 sizes/offsets. No ZIP64 implementation is added. |
| `app/local/Tidy.tsx` | Catch errors around `makeZip` and the ZIP download creation; display a specific failure message; reach existing `setProgress(null)`. | Avoid indefinite busy state and tell user to split a batch or use folder save where supported. |
| `tests/local-zip.test.mjs` | Four Node regression tests for ZIP headers/CRC/UTF-8, streaming, oversized sizes and excessive paths/entries. | Prevent regression of the memory and archive-limit fixes. |
| `docs/local-cuts-zip-streaming-handover.md` | This handover. | Enables independent Claude review and rollback. |

## 3. Before / after user experience

**Before:** ZIP export might consume substantially more memory than the audio already held in browser Blob references; oversized exports could appear to download but have invalid ZIP headers; packaging exceptions could leave the interface stuck showing progress.

**After:** ZIP export calculates checksums in streamed chunks, references the audio Blob without making another full-file array, and refuses unsupported ZIP32 sizes early with a visible error. Folder saving is unchanged. Original recordings are not modified. **This does not guarantee that a multi-gigabyte export will work in every browser.**

## 4. Technical assumptions, dependencies and compatibility

- ZIP entries use STORE (method 0), UTF-8 filename flag, CRC32, and ZIP32 local/central headers as before. Compression is not introduced.
- Modern browsers provide `Blob.stream()` returning a WHATWG `ReadableStream` with `getReader()`. Confirm compatibility on target Safari, Chrome, Edge and Firefox versions.
- Reading every source Blob once for CRC remains necessary. Only the **avoidable simultaneous full-size array copies** are removed. The existing `Tidy.save()` still constructs tidied Blobs for the whole batch before packaging.
- Existing MP3/FLAC metadata writing, local matching, player, ownership, database RPCs, file keys and saved preferences are not changed.
- The code rejects archives whose estimated final size exceeds 0xffffffff bytes, even if some ZIP32 readers might tolerate other edge-case layouts. That conservative bound is intentional.
- `onProgress` continues to fire after each file's CRC is finished, not for each chunk.

## 5. Data, privacy, costs, migrations and effects

**Database/schema migrations:** None. **External APIs/AI requests:** None. **User data uploads:** None. **New permissions:** None. **Server costs:** None. **Browser storage/localStorage keys:** No changes. **Original audio files:** Never written or deleted. **Exports:** Only newly generated ZIP copies are affected. The feature still uses browser RAM and temporary Blob references.

## 6. Verification actually performed

The author tested an **isolated standalone copy of the exact revised ZIP helper**, not a complete repository checkout:

1. `node --experimental-strip-types --test /mnt/data/localcuts_zip_test/test.mjs` — **4/4 passed**, using Node v22.16.0. Tested CRC, UTF-8 names, ZIP headers, streaming without Blob.arrayBuffer(), early rejection of >4 GB and >65,535-entry cases.
2. `tsc --noEmit --target es2022 --module esnext --lib dom,dom.iterable,es2022 --skipLibCheck /mnt/data/localcuts_zip_test/write.ts` — **passed** for isolated ZIP helper.
3. A ZIP created by the isolated helper was read with Python `zipfile.ZipFile`: both files and non-ASCII path decoded, `testzip() == None`, payloads verified.

**Not performed:** Full repository `npm run lint`, `npm run build`, execution of `tests/local-zip.test.mjs` against the committed complete `app/local/write.ts`, Vercel build, real-browser/real-audio-file export, large-folder performance/memory measurements. The UI error handling is code-reviewed but **not browser-tested**. Do not present the isolated results as end-to-end verification.

Claude should run:

```bash
node --experimental-strip-types --test tests/local-zip.test.mjs
node --experimental-strip-types --test tests/local-file-identity.test.mjs tests/local-version-match.test.mjs
npm run lint
npm run build
```

Also use an independent ZIP extractor to verify CRCs, filenames and file bytes for MP3/FLAC and nested Unicode paths; test ZIP fallback and directory-picker flows in real browsers, including a deliberate over-limit simulated case.

## 7. Risks, unresolved edge cases and caveats

- `Blob.stream()` may be unavailable in older browsers. Add a compatibility fallback only if target browser testing demonstrates a need.
- Existing `Tidy.save()` creates all tidied Blobs before ZIP packaging; memory is improved but not constant. A future streaming-to-disk/export architecture would be a separate project.
- Browser `new Blob([...parts])` implementations may differ in memory behaviour; measure rather than claim guaranteed O(1) memory.
- CRC streaming still reads the entire audio once, so export time and I/O remain proportional to file size.
- The UI still catches failures on individual file tag operations and logs them; this PR does not change that workflow.
- Folder-save errors outside ZIP handling still need separate attention.
- The error handler catches failures in ZIP construction and download setup; it cannot detect a later OS-level download failure.
- Test with Unicode filenames, long paths, nested directories, empty files and many files. Do not rely solely on synthetic tests.
- No ZIP64, no incremental progress per chunk, no cancellation; those are deliberate non-goals.

## 8. Claude's next steps

1. Check branch diff against the stated base; verify no unrelated files or changes.
2. Execute committed regression tests, lint and full build. Review errors, if any, before merge.
3. Test ZIP fallback in a browser, unzip with a separate utility, compare exported audio payload and tags with expected output. Use copies, never original music.
4. Check real memory behaviour with a moderately large folder and consider adding a user-facing size warning.
5. If approved, merge by normal reviewed PR only; record the **actual merge commit SHA and merge method** in `docs/local-cuts-claude-recovery.md` via a follow-up docs PR. Do not guess the SHA.
6. If a browser lacks Blob.stream support, address that in a separate small PR with tests.

## 9. Exact rollback / revert

**Before merge:** Close the draft PR and optionally delete only `fix/local-cuts-zip-streaming-20261025`. Main stays unchanged.

**After merge:** Find this PR and use GitHub's **Revert** button to create a separate review PR. If merged with a regular two-parent merge commit, use:

```bash
git fetch origin
git switch main
git pull --ff-only
git switch -c revert/local-cuts-zip-streaming
git revert -m 1 <ACTUAL_MERGE_COMMIT_SHA>
# inspect diff, test, push new branch, open review PR
```

If squash-merged, revert the actual single-parent squash commit with `git revert <SQUASH_SHA>` (no `-m 1`). Do not blindly revert feature branch commits after a squash merge. If subsequent work touches the same functions, resolve conflicts surgically instead of deleting later code.

**Selective removal:** Restore the original `crc32` and `makeZip` implementation and remove only the ZIP-specific `try/catch` in `Tidy.save()`; remove `tests/local-zip.test.mjs` and this handover if appropriate. Prefer a diff-based revert, **not** restoring entire files from an old commit.

## 10. Explicitly protect unrelated work

Do **not** undo merged PR #157 (file identity/mapping), #158 (version review/confirmation), #159 (Claude recovery docs), or Claude's earlier Local Cuts work while reverting this ZIP-only change. Do not reset/force-push main, delete the `app/local` folder, clear users' localStorage, delete exports, remove catalogue rows or modify source audio. Reverting this code does not stop the hourly automation.

**Bottom line:** Narrow, reversible ZIP export safety change; tested as an isolated helper, pending full checkout and browser validation. Treat this handover as a review aid, not a claim that production behaviour is verified.
