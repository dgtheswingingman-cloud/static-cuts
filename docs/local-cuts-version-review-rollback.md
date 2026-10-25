# Local Cuts — review and rollback

This document concerns the Local Cuts version-review change, proposed via a **draft pull request**, not an automatic deployment.

## How to discard this code before merge
1. Open the associated draft pull request.
2. Choose **Close pull request**. Nothing on `main` changes.
3. Optionally delete its feature branch from the closed PR.

## How to undo it after merge
1. Find the Local Cuts PR under **GitHub → Pull requests → Closed** (look for the merged PR titled **Local Cuts: require version confirmation before retagging**).
2. Use GitHub's **Revert** action, if available, to create a new PR undoing its commits. Review and merge the revert PR.
3. If GitHub cannot auto-revert because later work depends on the same files, ask for a targeted revert on a fresh branch. **Do not reset main, force-push, or roll back the whole project.**
4. If the change was deployed, verify your hosting platform has deployed the revert before calling it removed.

No database migration, production setting, or external audio storage is changed by this PR. The code change does not edit original music files. Existing file exports are independent copies and are **not** erased by reverting the site.

## How to clear personal Local Cuts data

On `/local`, choose **reset Local Cuts** and confirm. This clears the browser's remembered matches, selected files, and formatting preferences. It does NOT delete:
- Original audio recordings stored on your device
- Previously exported, tidied copies
- Songs you deliberately added to your online Static Cuts collection
- Any database song records

## If automated matching is inaccurate
Stop before using **Tidy & Save**. Check the candidate under **Matches & player → choose version**. Automatic candidates are not verified and are not allowed to overwrite file metadata using archive values until you explicitly confirm the recording.

## Release gates
- Review the PR diff.
- Run `node --experimental-strip-types --test tests/local-version-match.test.mjs`.
- Run `npm run lint` and `npm run build` in a checkout with dependencies.
- Manually test an artist's main song plus V2/demo files, duplicate titles, missing versions, old saved items and reset.
- Don't merge or deploy while those checks are unresolved.
