// Local Cuts: the music files picked this visit, kept in the browser's
// memory only (never uploaded, gone when the tab closes). Song pages ask
// here whether you have a file of that song to play.

const files = new Map<string, File>(); // song id -> file
const listeners = new Set<() => void>();

export function setLocalFile(trackId: string, file: File | null) {
  if (file) files.set(trackId, file); else files.delete(trackId);
  listeners.forEach((l) => l());
}
export function localFileFor(trackId: string): File | null {
  return files.get(trackId) ?? null;
}
export function onLocalFiles(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
