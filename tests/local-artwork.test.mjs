import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalArtworkMime, MAX_COVER_BYTES } from "../app/local/artwork.ts";

test("JPEG signature wins over a wrong HTTP content type", () => {
  assert.equal(canonicalArtworkMime(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
});
test("PNG signature is accepted", () => {
  assert.equal(canonicalArtworkMime(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10])), "image/png");
});
test("HTML and empty responses cannot be embedded as fake album art", () => {
  assert.throws(() => canonicalArtworkMime(new TextEncoder().encode("<html>login</html>")), /supported JPEG or PNG/);
  assert.throws(() => canonicalArtworkMime(new Uint8Array()), /supported JPEG or PNG/);
});
test("unsupported WebP artwork is rejected rather than mislabelled JPEG", () => {
  assert.throws(() => canonicalArtworkMime(new TextEncoder().encode("RIFF____WEBP")), /supported JPEG or PNG/);
});
test("oversized artwork is rejected", () => {
  assert.throws(() => canonicalArtworkMime(new Uint8Array(MAX_COVER_BYTES + 1)), /10 MB limit/);
});
