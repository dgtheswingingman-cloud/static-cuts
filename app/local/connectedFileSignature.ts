// A mutable file map can gain/reconnect files without changing its identity.
// Use a stable, unambiguous signature of connected keys to invalidate previews.
export function connectedFileSignature(files: ReadonlyMap<string, unknown>): string {
  return [...files.keys()].sort().map((key) => `${key.length}:${key}`).join("|");
}
