import { test } from "node:test";
import assert from "node:assert/strict";
import { mp3AudioBounds, tidiedCopy } from "../app/local/write.ts";

const audio = new Uint8Array([0xff, 0xfb, 0x90, 0x64, 1, 2, 3, 4]);
const tags = { title: "Canonical Title", artist: "Canonical Artist", album: "Unreleased" };

function id3Header(size, version = 3, flags = 0) {
  return new Uint8Array([73, 68, 51, version, 0, flags,
    (size >>> 21) & 127, (size >>> 14) & 127, (size >>> 7) & 127, size & 127]);
}
async function exportedAudio(file) {
  const out = new Uint8Array(await (await tidiedCopy(file, tags)).arrayBuffer());
  assert.equal(Buffer.from(out.subarray(0, 3)).toString(), "ID3");
  assert.equal(out[3], 3, "exported tag should be ID3v2.3");
  const size = (out[6] << 21) | (out[7] << 14) | (out[8] << 7) | out[9];
  assert.ok(Buffer.from(out).includes(Buffer.from("TIT2")), "new title frame present");
  return out.subarray(10 + size);
}

test("MP3 with no old tags retains every audio byte", async () => {
  const file = new File([audio], "song.mp3");
  assert.deepEqual(await exportedAudio(file), audio);
  assert.deepEqual(new Uint8Array(await file.arrayBuffer()), audio, "original file unchanged");
});

test("MP3 strips a valid ID3v2.3 tag without touching audio", async () => {
  const file = new File([id3Header(4), new Uint8Array([7, 8, 9, 10]), audio], "song.mp3");
  assert.deepEqual(await exportedAudio(file), audio);
});

test("MP3 strips the optional ID3v2.4 footer and the old ID3v1 trailer", async () => {
  const trailer = new Uint8Array(128); trailer.set([84, 65, 71]);
  const footer = id3Header(2, 4, 0x10); footer.set([51, 68, 73]); // 3DI + matching header
  const file = new File([id3Header(2, 4, 0x10), new Uint8Array([9, 9]),
    footer, audio, trailer], "song.mp3");
  assert.deepEqual(await exportedAudio(file), audio);
});

test("MP3 rejects a claimed ID3v2.4 footer if its signature is missing", async () => {
  const file = new File([id3Header(2, 4, 0x10), new Uint8Array([9, 9]),
    audio, new Uint8Array(10)], "song.mp3");
  await assert.rejects(tidiedCopy(file, tags), /Invalid MP3 ID3v2.4 footer/);
});

test("MP3 rejects a footer with mismatched size even when its signature is valid", async () => {
  const footer = id3Header(3, 4, 0x10); footer.set([51, 68, 73]);
  const file = new File([id3Header(2, 4, 0x10), new Uint8Array([9, 9]),
    footer, audio], "song.mp3");
  await assert.rejects(tidiedCopy(file, tags), /Invalid MP3 ID3v2.4 footer/);
});

test("MP3 v2.3 reserved footer bit does not discard ten audio bytes", async () => {
  const file = new File([id3Header(2, 3, 0x10), new Uint8Array([9, 9]), audio], "song.mp3");
  assert.deepEqual(await exportedAudio(file), audio);
});

test("MP3 rejects invalid synchsafe ID3 sizes instead of losing audio", async () => {
  const bad = id3Header(0); bad[6] = 0x80;
  await assert.rejects(tidiedCopy(new File([bad, audio], "song.mp3"), tags), /Invalid MP3 ID3 header/);
});

test("MP3 rejects ID3 size beyond the file instead of exporting metadata only", async () => {
  await assert.rejects(tidiedCopy(new File([id3Header(9999), audio], "song.mp3"), tags), /no audio bytes/);
});

test("MP3 rejects a tag-only file and truncated ID3 header", async () => {
  await assert.rejects(tidiedCopy(new File([id3Header(0)], "song.mp3"), tags), /no audio bytes/);
  await assert.rejects(tidiedCopy(new File([new Uint8Array([73, 68, 51, 3])], "song.mp3"), tags), /Invalid MP3 ID3 header/);
});

test("MP3 bounds leave an untagged file intact and do not mistake a short tail for ID3v1", () => {
  assert.deepEqual(mp3AudioBounds(audio, audio.length), { start: 0, end: audio.length });
});

test("MP3 accepts an ID3v2.2 tag and retains the audio payload", async () => {
  const file = new File([id3Header(2, 2), new Uint8Array([9, 8]), audio], "song.mp3");
  assert.deepEqual(await exportedAudio(file), audio);
});

test("MP3 accepts an ID3v2.4 tag without a footer", async () => {
  const file = new File([id3Header(2, 4), new Uint8Array([9, 8]), audio], "song.mp3");
  assert.deepEqual(await exportedAudio(file), audio);
});

test("MP3 rejects a v2.4 footer declared beyond end of file", async () => {
  const file = new File([id3Header(20, 4, 0x10), audio], "song.mp3");
  await assert.rejects(tidiedCopy(file, tags), /Invalid MP3 ID3v2.4 footer/);
});

test("MP3 rejects an unsupported ID3 version instead of guessing bounds", async () => {
  const file = new File([id3Header(2, 5), new Uint8Array([9, 8]), audio], "song.mp3");
  await assert.rejects(tidiedCopy(file, tags), /Invalid MP3 ID3 header/);
});

test("MP3 strips a standalone ID3v1 tail after untagged audio", async () => {
  const trailer = new Uint8Array(128); trailer.set([84, 65, 71]);
  const file = new File([audio, trailer], "song.mp3");
  assert.deepEqual(await exportedAudio(file), audio);
});


test("MP3 rejects a 128-byte ID3v1-only file with no audio", async () => {
  const trailer = new Uint8Array(128); trailer.set([84, 65, 71]);
  const file = new File([trailer], "tag-only.mp3");
  await assert.rejects(tidiedCopy(file, tags), /no audio bytes/);
  assert.deepEqual(new Uint8Array(await file.arrayBuffer()), trailer, "original metadata-only input unchanged");
});
