// Metadata-only version recommendations. Audio identity is never inferred from a title.
export type VersionCandidate = {
  id: string;
  title: string;
  parent_track_id: string | null;
};
export type VersionAssessment = {
  candidate: VersionCandidate | null;
  reason: string;
};
function titleKey(value: string): string {
  return value.toLowerCase()
    .replace(/\s*[([\uFF08]\s*(?:feat\.?|ft\.?|featuring|with|prod\.?)\s+[^)\]\uFF09]*[)\]\uFF09]/gi, "")
    .replace(/\s*[([\uFF08]\s*(?:official (?:music )?video|official audio|lyrics?|visuali[sz]er)\s*[)\]\uFF09]/gi, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim().replace(/\s+/g, " ");
}
function filenameTitle(fileName: string, artist: string | null): string {
  let title = fileName.replace(/\.[^.]+$/, "").replace(/_/g, " ").replace(/^\s*\d{1,3}\s*[-.)]?\s+/, "").trim();
  if (artist) {
    const sep = title.search(/\s+[-–—]\s+/);
    if (sep >= 0 && titleKey(title.slice(0, sep)) === titleKey(artist)) {
      title = title.slice(sep).replace(/^\s*[-–—]\s*/, "");
    }
  }
  return title;
}
// Broad labels like "original" and "mix" may be part of a real song title.
function hasVersionLabel(value: string): boolean {
  return /(?:^|\b)(?:v[2-9]\d*|demo|instrumental|acapella|a cappella|remix|remaster(?:ed)?|acoustic|live|snippet|alternate|alt|og|rough|reference|ref|take\s*\d+|version\s*\d+|slowed|sped\s*up|extended|radio\s*edit)(?:\b|$)/i.test(value);
}
export function assessVersion(
  fileName: string,
  fileTitle: string | null,
  artist: string | null,
  candidates: readonly VersionCandidate[],
  allVersionsLoaded = true,
): VersionAssessment {
  if (!allVersionsLoaded) return { candidate: null, reason: "Could not check every version; choose the correct recording manually." };
  if (candidates.length === 0) return { candidate: null, reason: "No linked versions were found to compare." };
  // Filenames often contain V2/demo labels that embedded tags omit.
  const sources = [filenameTitle(fileName, artist), fileTitle ?? ""].filter(Boolean);
  for (const source of sources) {
    if (!hasVersionLabel(source)) continue;
    const key = titleKey(source);
    const exact = candidates.filter((candidate) => titleKey(candidate.title) === key);
    if (exact.length === 1) {
      return { candidate: exact[0], reason: `Possible ${exact[0].parent_track_id ? "version" : "song"} match: “${exact[0].title}”. Confirm the recording before using its tags.` };
    }
    if (exact.length > 1) return { candidate: null, reason: "Several catalogue entries share this version title. Pick one manually." };
  }
  if (candidates.length > 1) return { candidate: null, reason: `${candidates.length} linked song/version entries exist. Choose which recording you have.` };
  return { candidate: null, reason: "Artist and title suggest this song, but the recording has not been verified." };
}
