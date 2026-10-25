// Stable, local-only identity for picked audio files.
// A filename + byte count is NOT unique: two different recordings can share both.
// Hash at most 192 KiB per file, not the entire recording, to keep large folders responsive.
// This is a collision-resistant *reconnection key*, not an audio fingerprint or song ID.
const EDGE_BYTES = 96 * 1024;
const text = new TextEncoder();

export function filePath(file: Pick<File, "name"> & { webkitRelativePath?: string }): string {
  return (file.webkitRelativePath || file.name).replace(/\\/g, "/");
}

export async function fileKey(file: File): Promise<string> {
  const first = new Uint8Array(await file.slice(0, EDGE_BYTES).arrayBuffer());
  const last = file.size > EDGE_BYTES
    ? new Uint8Array(await file.slice(Math.max(EDGE_BYTES, file.size - EDGE_BYTES)).arrayBuffer())
    : new Uint8Array(0);
  const header = text.encode(`Static Cuts local file v1:${file.size}:`);
  const data = new Uint8Array(header.length + first.length + last.length);
  data.set(header);
  data.set(first, header.length);
  data.set(last, header.length + first.length);
  // static-cuts.com is HTTPS; SubtleCrypto is available in secure contexts.
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  const hex = Array.from(digest.subarray(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
  return `v1|${encodeURIComponent(filePath(file))}|${file.size}|${hex}`;
}

export function unusedKey(baseKey: string, reserved: ReadonlySet<string>): string {
  if (!reserved.has(baseKey)) return baseKey;
  let suffix = 2;
  while (reserved.has(`${baseKey}#${suffix}`)) suffix++;
  return `${baseKey}#${suffix}`;
}
