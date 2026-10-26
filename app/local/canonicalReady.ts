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
