# Claude handover — Local Cuts FLAC metadata-boundary safety

**Prepared:** 2026-10-26 UTC  
**Repository:** `dgtheswingingman-cloud/static-cuts`  
**Draft branch:** `fix/local-cuts-flac-metadata-bounds-20261026`  
**Base:** `main` at `ec35a82c6f7d0f04c0c93e596ba3f7899223e603` (merged PR #160).  
**Related open drafts:** #161 (cumulative recovery documentation), #162 (separate MP3 bounds).  
**Status:** REVIEW ONLY. Do not merge, deploy, force-push, modify originals or change production settings.

## 1. Aim, observed defect and evidence

Local Cuts' primary job is safe canonical Spotify Local Files formatting, with user overrides. On main, `writeFlac()` in `app/local/write.ts` advanced its metadata cursor using a declared 24-bit length **without checking whether the complete block existed**. If the final metadata block claimed more bytes than the file contained, `file.slice(p)` became empty and a newly tagged export could contain no audio. This was first recorded in PR #162's handover section 15; do not duplicate that investigation.

This run independently reproduced the defect **against the original function extracted from main** using an in-memory V8 harness: a synthetic `fLaC` header, 34-byte STREAMINFO, a final padding block claiming 100 bytes but containing only eight bytes, and no other payload produced an output with zero audio bytes after generated metadata. The synthetic bytes are **not a real, playable FLAC file**; this is a metadata-boundary reproduction, not a production incident or a Spotify compatibility claim.

The same audit found that the old Vorbis parser used `DataView` offsets against the full read-ahead buffer instead of checking each comment's length against the **individual Vorbis block**. Malformed lengths could read into subsequent metadata/audio bytes or throw an unhelpful bounds exception.

## 2. Base, changed files, exact functions and why

- `app/local/write.ts`, `writeFlac(file, t)`: reject wrong FLAC signature instead of silently copying an untagged file; require each four-byte metadata header and its full declared body to fit the 16 MiB read-ahead buffer and source size; require first metadata block to be STREAMINFO (type 0, exactly 34 bytes); parse Vorbis vendor/comment count/individual comment lengths **within that block** with explicit guards; reject a source with zero bytes following final metadata; reject generated Vorbis/picture/other blocks larger than FLAC's 24-bit metadata length limit before writing their headers. Valid metadata, preserved unknown fields, cover replacement, and audio `Blob.slice(p)` remain otherwise unchanged. No MP3, ZIP, matching or player logic is edited.
- `tests/local-flac-export.test.mjs` (new): twelve Node `node:test` cases using synthetic FLAC-shaped `File` objects. They exercise valid payload retention, canonical replacement/preservation of custom comments, malformed declared lengths, truncated next header, absent/wrong STREAMINFO, metadata-only input, invalid Vorbis vendor/count/entry lengths, wrong signature, too-large output picture block and small replacement artwork. Source bytes are checked for unchanged input in failure tests.
- `docs/local-cuts-flac-bounds-handover.md` (this document): complete evidence, validation provenance, risks, review and rollback instructions.

**Base source blob:** `8fcc3a5fec7e6b8d9f254969c959d8e67aa5b1f6`.  
**Code commit:** `6e71ef89d6a992f81149447cbe3e268fd756f55f`.  
**Test commit:** `1fa400e7606dccce47e71302e7b500a552138178`.  
Do not mistake branch commits for a future merge commit.

## 3. Before / after user behaviour

**Before:** malformed or truncated FLAC metadata could be interpreted as a complete block; a canonical export could be created with no original audio. An invalid `.flac` file could be silently returned without new tags.  
**After:** these inputs reject export with a descriptive error, so they cannot be mistaken for successfully formatted copies. Properly bounded FLAC-shaped inputs still get canonical tags while retaining their original audio byte range. Originals are never overwritten.

**Limit:** bytes after the last metadata block are assumed to be audio; this patch does **not** validate or decode FLAC frames. A malformed file with arbitrary trailing bytes may still be exported and remain unplayable.

## 4. Assumptions, dependencies and existing features

FLAC begins with `fLaC`; its first metadata block is 34-byte STREAMINFO; block bodies use unsigned 24-bit lengths; Vorbis vendor and entry lengths are unsigned little-endian 32-bit. The current writer reads at most **16 MiB** of initial source bytes. Files with metadata extending beyond that read window now reject instead of silently returning an untagged file. This is an intentional safety trade-off; larger legitimate metadata should be supported through bounded incremental reads in a future reviewed change.

No new package or runtime dependency. Uses existing `Blob`, `DataView`, `TextDecoder` and typed arrays. No changes to MP3 writer, ZIP creation, file identity, version confirmation, catalogue matching, formatting preferences, or playback. Because PR #162 also edits `app/local/write.ts`, Claude must inspect the actual final diffs and carefully integrate both independent changes when reviewing; never overwrite either branch wholesale.

## 5. Data, API, privacy, cost and browser storage consequences

**Database/schema/migrations:** none. **Remote API calls:** none added. **Third-party services/AI calls:** none. **Dependencies:** none. **User account/collection data:** none. **Browser localStorage/IndexedDB/caches:** none changed. **Privacy/data uploads:** none; processing remains local to the browser. **Hosting/runtime billing:** no new service or expected network cost. **Original audio writes/deletions:** none; exported `Blob` copies only. **Production settings/deployment:** none. **Performance:** retains existing up-to-16 MiB initial read and in-memory metadata construction; validation adds a small amount of CPU and may reject malformed or unusually large metadata instead of passing it through.

## 6. Verification actually executed vs not executed

**Executed 2026-10-26 in the connected JavaScript V8 runtime:** extracted the original `writeFlac()` function from main and the patched function from the exact candidate source, removed TypeScript-only syntax for evaluation, and used ASCII-only TextEncoder/TextDecoder and Blob shims. **15/15 focused assertions passed**: source byte preservation, valid payload retention, original malformed-block reproduction (old exporter lost the payload), patched rejection of truncated block/header, missing audio, wrong STREAMINFO, bad signature, bad vendor/count/entry lengths, valid comment replacement, preservation of custom comments and payload. These are **in-memory harness checks**, not the committed test suite, real browser APIs or a complete checkout.

**Additional executed check after creating the draft:** re-fetched the exact committed `tests/local-flac-export.test.mjs` (blob `f764e21b4b653c51ed5d208804654468d93f3ba6`) and patched writer (blob `8af46b8f44efd7fe71297d7480fca1154e553ad4`); evaluated **all 12 committed test bodies in V8** using a custom `test`/`assert` harness and ASCII TextEncoder/TextDecoder plus Blob/File shims. **12 passed, 0 failed**, including oversized artwork. This is *not* Node's `node:test` runner, the actual browser Blob/File implementations or a complete repository test run.

**Written but NOT run in the intended Node environment:** the twelve committed `tests/local-flac-export.test.mjs` tests. They still require execution with `node --experimental-strip-types --test` against a full checkout.

**Attempted:** `git ls-remote https://github.com/dgtheswingingman-cloud/static-cuts.git HEAD` from the execution container. It failed: `Could not resolve host: github.com`. Therefore no full repository checkout or `node --experimental-strip-types --test` run was possible.

**Not run:** `node --experimental-strip-types --test tests/local-flac-export.test.mjs`, full Local Cuts suites, `npm run lint`, `npm run build`, independent FLAC decoders, real recordings, browser exports, artwork inspection in Spotify, Spotify Local Files import or device sync. Do not describe any of these as passed. No GitHub Actions test workflow was observed on the related PR #162; Vercel's green status is not a substitute for tests.

## 7. Edge cases, unresolved risks and defects

- No FLAC frame integrity/CRC or codec decoding check. Non-empty trailing bytes are not proof of playable audio.
- The writer currently supports metadata parsing only inside a 16 MiB read-ahead. Legitimate oversized pictures or unusual metadata may now fail safely.
- A generated picture > 24-bit block limit is detected after constructing its in-memory bytes; a future streaming/early-limit design could reduce memory pressure.
- Invalid UTF-8 Vorbis strings may be decoded with replacement characters; this change does not alter Unicode policy.
- Duplicate Vorbis comment blocks and malformed-but-in-bounds comment structures deserve real decoder checks.
- The existing writer preserves many unknown metadata blocks but removes padding and optionally replaces picture blocks; inspect output with `metaflac` or `ffprobe` on **copies**.
- If PR #162 lands first, reconcile `write.ts` changes without dropping its MP3 guards; if this PR lands first, #162 must preserve these FLAC guards.
- Browser per-file failure UX and how batch export reports rejected tracks remain unverified.
- Synthetic fixtures are deliberately not valid playable FLAC recordings.

## 8. Claude next steps and exact verification

1. Review this draft's **Files changed** against current `main`; inspect PR #161 and #162 first and check their merge status. Preserve all unrelated Claude changes.
2. In a real checkout of this draft, run:
   ```bash
   node --experimental-strip-types --test tests/local-flac-export.test.mjs
   node --experimental-strip-types --test tests/local-mp3-export.test.mjs # only if PR #162 has been integrated; otherwise run its suite on that branch
   node --experimental-strip-types --test tests/local-file-identity.test.mjs tests/local-version-match.test.mjs
   npm run lint
   npm run build
   ```
   Report actual output and failures. Correct any test or code defects **on this draft branch**.
3. Test copies of real valid FLACs with existing Vorbis comments, artwork, multiple metadata blocks, large artwork, and corrupted/truncated metadata. Compare source and exported audio frame bytes and independently decode using `flac -t`, `metaflac` and/or `ffprobe`. Test canonical tags and custom overrides.
4. Manually test the batch export error path in supported browsers; confirm failed files are clearly flagged and original files remain unchanged. Verify actual Spotify Local Files import/artwork on target desktop/mobile clients.
5. Resolve overlapping `write.ts` hunks with PR #162 using a carefully reviewed integration, not a wholesale restore. Request Claude review; **do not auto-merge**.

## 9. Precise reversible rollback

**Before merge:** close this draft PR and leave `main` untouched; no production or user-file rollback needed. If a reviewer wants only part of the fix removed, make a targeted inverse commit on the same draft and rerun tests.

**After a future reviewed merge:** obtain the **actual merge SHA** from GitHub (currently **UNKNOWN — NOT MERGED**). Verify commit parent count: for a two-parent merge use `git revert -m 1 <ACTUAL_MERGE_SHA>` on a new revert branch; for a squash commit use `git revert <ACTUAL_SQUASH_SHA>`. Open a separate **draft revert PR**, inspect changed paths and conflicts, run tests and seek review. Never force-push/reset `main`, delete exports, or overwrite the whole `write.ts` file. If other PRs subsequently modify the FLAC code, reverse only this PR's exact hunks instead of removing their changes. Once merged, update this section and `docs/local-cuts-claude-recovery.md` with the actual SHA through a **separate docs-only draft PR**, correcting any stale status.

## 10. What must NOT be reverted or removed

Do **not** remove unrelated Claude work, existing Local Cuts UI/player code, matching/version-confirmation from merged PRs #157/#158, merged #159 recovery docs, merged #160 ZIP safety, draft #161 documentation, draft #162 MP3 boundary checks, user-selected canonical formatting overrides, user originals or downloaded copies, server collection rows, browser preferences, production configuration or any later independent fixes. A FLAC rollback must be narrowly scoped to this PR.

**Product reminder:** Spotify Local Files preparation with canonical Static Cuts metadata by default and user customisation is the priority; a standalone player is not.
