// Local Cuts: never export a confirmed match using fallback local tags while
// its canonical archive metadata is still unavailable.
export type ExportCandidate = {
  key: string;
  track_id: string | null;
  status: "sure" | "check" | "none";
};

export function confirmedExportIds(
  items: readonly ExportCandidate[],
  files: ReadonlyMap<string, unknown>,
): string[] {
  const ids = new Set<string>();
  for (const item of items) {
    if (item.status === "sure" && item.track_id && files.has(item.key)) ids.add(item.track_id);
  }
  return [...ids];
}

export function missingCanonicalIds(
  ids: readonly string[],
  info: Readonly<Record<string, unknown>>,
): string[] {
  return ids.filter((id) => !Object.prototype.hasOwnProperty.call(info, id));
}

// Keep failures attached to the lookup that produced them. A changed
// confirmed-track selection or explicit retry must not display an old error.
export type CanonicalLookupError = { requestKey: string; message: string };

export function lookupErrorForRequest(
  error: CanonicalLookupError | null,
  requestKey: string,
): string | null {
  return error?.requestKey === requestKey ? error.message : null;
}


// A manual tag override was entered for one matched recording. If that file is
// reassigned to another archive track/version, the old title/artist/album/year
// overrides must not silently mask the new canonical metadata. Changing only
// confirmation status or choosing the same track keeps intentional overrides.
export function matchUpdatePatch<T extends {
  track_id: string | null;
  owned: boolean;
  edit?: { title?: string; artist?: string; album?: string; year?: string };
}>(previous: T | undefined, patch: Partial<T>): Partial<T> {
  if (!previous || patch.track_id === undefined || patch.track_id === previous.track_id) return patch;
  return { ...patch, owned: false, edit: undefined };
}
