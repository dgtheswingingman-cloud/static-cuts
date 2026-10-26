// Spotify Local Files artwork: embed only actual JPEG/PNG image bytes.
// A URL returning HTML or an unsupported format must never become an ID3/FLAC picture.
export const MAX_COVER_BYTES = 10 * 1024 * 1024;

export function canonicalArtworkMime(bytes: Uint8Array): "image/jpeg" | "image/png" {
  if (bytes.byteLength > MAX_COVER_BYTES) {
    throw new Error("Canonical cover artwork exceeds the 10 MB limit.");
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return "image/png";
  }
  throw new Error("Canonical cover artwork is not a supported JPEG or PNG image.");
}
