# Claude handover — reconciliation of merged Local Cuts PRs #161–#163

**Prepared:** 2026-10-26 19:59 UTC. **Repository:** `dgtheswingingman-cloud/static-cuts`. **Branch:** `docs/local-cuts-161-163-merge-ledger-20261026`. **Base:** `main` commit `8a9de3f367588788204f0eaa996458d69498abfd`. **Status:** documentation-only draft PR, **NOT merged**; no merge SHA yet. **Product scope:** Spotify Local Files preparation with canonical metadata by default, user overrides and non-destructive copies; standalone player not prioritized.

## 1. Aim, observed defect and evidence
On 2026-10-26 at 19:21 UTC, GitHub reports PRs #161, #162 and #163 merged, but the recovery ledger on main still lists only #157/#158/#160 and their original MP3/FLAC handovers describe those branches as drafts. This is a demonstrable stale-status and rollback-provenance defect. The GitHub PR API, main commit history, merge commit parent arrays, changed-file lists and Vercel commit statuses were checked. The user's recent concern about the failed #164 deployment makes a clear separation of **merged main** from **failing draft** especially important.

## 2. Base, changed paths/functions/logic/why
- `docs/local-cuts-claude-recovery.md`: update verified merge state, add #161–#163 ledger rows with exact merge SHAs and changed paths; add section 1A with intended before/after audio behaviour, data/API/storage effects, precise rollback ordering and remaining tests; identify unmerged #164 failure. No application functions changed.
- `docs/local-cuts-mp3-bounds-handover.md`: prepend current merge-status correction and exact two-parent revert guidance. Preserve original historical testing evidence and pre-merge wording for provenance.
- `docs/local-cuts-flac-bounds-handover.md`: same status correction for #163; explicitly preserve #162 when reverting #163.
- `docs/local-cuts-161-163-merge-handover.md`: this full documentation-only handover.

**Verified merged history:** #161 `d9cab3dfdfc210aa98db2b824988e2ca45150209` (docs recovery and ZIP handover); #162 `bcdd9570fd9ebf1ffdc70c4104abe3e1da09a0d6` (`app/local/write.ts`, MP3 test, MP3 handover); #163 `8a9de3f367588788204f0eaa996458d69498abfd` (`app/local/write.ts`, FLAC test, FLAC handover). All three are confirmed **two-parent** merge commits. #164 is still a draft at `4e7d5a9b2f6e49b0661b8979aacb68aabf446bc9`, with a failing Vercel status.

## 3. Before/after user behaviour
Before this PR, the ledger and individual handovers could incorrectly imply that already merged MP3/FLAC changes were still drafts, leading to wrong merge/revert instructions. After this PR, Claude and reviewers can identify the actual merged main, exact reversible commit sequence, known limits and the separate unmerged #164. **Audio export, matching, canonical tags, UI and site behaviour do not change** in this PR.

## 4. Technical assumptions, dependencies and effect on existing features
Only Markdown text is edited; no code or dependency is introduced. GitHub's PR/commit APIs are treated as authoritative for merge state and parentage at inspection time. Vercel commit status success is **not** a substitute for tests. The source-level MP3/FLAC changes are described from their existing merged handovers; no new claims of real-audio validation are made. The document is a dated snapshot and must be refreshed if main moves.

## 5. Data/API/privacy/cost/browser storage consequences
**Database/schema:** none. **New APIs or requests by the application:** none. **Privacy, uploads, original audio writes, export changes:** none. **New packages, hosting/runtime or billing costs:** none. **Browser localStorage/IndexedDB/cookies:** none. **Production configuration/deployment:** none. GitHub API reads and documentation commits/PR are the only remote actions.

## 6. Tests actually run versus missing checks
**Executed checks:** GitHub PR endpoints confirmed merged timestamps and merge SHAs; GitHub commit endpoint confirmed two parents for each of #161/#162/#163 and the changed paths; GitHub commit statuses reported Vercel `success` on all three merged commits, `failure` on #164. Fetched the current main ledger and both individual handovers and verified their stale status text. **Attempted:** `git ls-remote https://github.com/dgtheswingingman-cloud/static-cuts.git HEAD` in the execution container; failed with `Could not resolve host: github.com`. **No Node tests, npm lint, npm build, browser tests, real MP3/FLAC exports, independent decoder tests or Spotify imports were executed in this run.** The earlier isolated V8/Node checks in #162/#163 handovers are historical and narrower than a repository build. A successful deployment status on main is not evidence of application-level correctness.

## 7. Edge cases and unresolved risks
#164's failed Vercel deployment is not diagnosed; GitHub shows a status target URL but the connected GitHub tools cannot fetch Vercel's internal build logs. The draft originated from an older base and needs review against the now-merged MP3/FLAC writer. The merged code still needs complete checkout, browser and real-file validation. Future commits may change rollback conflicts or invalidate this snapshot. Avoid assuming that corrupt MP3/FLAC rejection proves all playable files are handled.

## 8. Precise next steps for Claude/reviewer
1. Review this docs-only diff; confirm `main` and merged PRs again before merging this documentation PR.
2. On a real checkout, run `node --experimental-strip-types --test tests/local-file-identity.test.mjs tests/local-version-match.test.mjs tests/local-zip.test.mjs tests/local-mp3-export.test.mjs tests/local-flac-export.test.mjs`, `npm run lint`, `npm run build`. Record actual results, not assumed successes.
3. Diagnose #164 via actual Vercel logs or a local full build. Review its old-base diff against #162/#163, then test canonical metadata, overrides, artwork and safe copies with real audio and Spotify Local Files before recommending a merge.
4. After this documentation PR is merged by a human, record its **actual** merge SHA in the cumulative ledger via a later documentation-only draft. Never edit main directly.

## 9. Reversible rollback
**Before merge:** close this draft; main remains untouched by it. **After merge:** obtain the actual merge SHA (currently **NOT AVAILABLE**), verify parent count and intervening edits, create a fresh rollback branch, and revert only this documentation PR (`git revert -m 1 <ACTUAL_MERGE_SHA>` for a verified two-parent merge, or `git revert <ACTUAL_SQUASH_SHA>` for a squash). Inspect resulting Markdown changes, run relevant checks and open a draft revert PR; never force-push or reset main. If the MP3/FLAC *code* itself requires rollback, separately revert #163 then #162 in a reviewed branch using their verified merge SHAs; do not conflate this documentation PR with a code rollback.

## 10. What MUST NOT be reverted or removed
Do not delete or overwrite unrelated Claude work; merged Local Cuts #157/#158 version and identity protections, #160 ZIP safety, #162 MP3 or #163 FLAC protections unless specifically reviewed; #159/#161 historical recovery documentation; #164's independent draft; original recordings, downloaded exports, user preferences, server collections, production settings or unrelated site files. Never restore the whole `app/local` folder from an old commit.

## 11. Review evidence and links
- Merged PRs: https://github.com/dgtheswingingman-cloud/static-cuts/pull/161 , https://github.com/dgtheswingingman-cloud/static-cuts/pull/162 , https://github.com/dgtheswingingman-cloud/static-cuts/pull/163
- Unmerged failing draft: https://github.com/dgtheswingingman-cloud/static-cuts/pull/164
- Source ledger: `docs/local-cuts-claude-recovery.md`. This PR intentionally contains **no application code**.
