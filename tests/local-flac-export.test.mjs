import { test } from "node:test";
import assert from "node:assert/strict";
import { tidiedCopy } from "../app/local/write.ts";

// These synthetic FLAC-shaped bytes test metadata boundaries and byte retention.
// They are NOT decoded, playable FLAC fixtures and do not prove Spotify support.
const tags = { title: "Canonical Title", artist: "Canonical Artist" };
const audio = Uint8Array.from([0xff, 0xf8, 1, 2, 3, 4, 5, 6]);
const info = new Uint8Array(34); // FLAC STREAMINFO has a fixed 34-byte body.
const enc = new TextEncoder();

function le32(n) {
  return Uint8Array.from([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);
}
function block(type, last, data, declaredLength = data.length) {
  return [Uint8Array.from([(last ? 0x80 : 0) | type,
    (declaredLength >>> 16) & 255, (declaredLength >>> 8) & 255, declaredLength & 255]), data];
}
function file(...parts) {
  return new File([enc.encode("fLaC"), ...parts.flat(Infinity)], "sample.flac");
}
function vorbis(...entries) {
  const parts = [le32(0), le32(entries.length)]; // empty vendor string
  for (const entry of entries) {
    const bytes = enc.encode(entry);
    parts.push(le32(bytes.length), bytes);
  }
  return new Blob(parts);
}
async function parseExport(source) {
  const bytes = new Uint8Array(await (await tidiedCopy(source, tags)).arrayBuffer());
  assert.equal(new TextDecoder().decode(bytes.subarray(0, 4)), "fLaC");
  let p = 4;
  const blocks = [];
  for (;;) {
    assert.ok(p + 4 <= bytes.length, "export metadata header fits");
    const last = (bytes[p] & 0x80) !== 0, type = bytes[p] & 0x7f;
    const length = (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3];
    assert.ok(p + 4 + length <= bytes.length, "export metadata body fits");
    blocks.push({ type, data: bytes.subarray(p + 4, p + 4 + length) });
    p += 4 + length;
    if (last) break;
  }
  return { blocks, audio: bytes.subarray(p) };
}
async function rejectWithoutMutation(source, pattern, customTags = tags) {
  const before = new Uint8Array(await source.arrayBuffer());
  await assert.rejects(tidiedCopy(source, customTags), pattern);
  assert.deepEqual(new Uint8Array(await source.arrayBuffer()), before, "original input unchanged");
}

test("valid STREAMINFO: canonical comments written and all source audio bytes retained", async () => {
  const source = file(block(0, true, info), audio);
  const before = new Uint8Array(await source.arrayBuffer());
  const out = await parseExport(source);
  assert.deepEqual(out.audio, audio);
  assert.equal(out.blocks[0].type, 0);
  const commentBlock = out.blocks.find((b) => b.type === 4);
  assert.ok(commentBlock, "new Vorbis comments present");
  assert.match(new TextDecoder().decode(commentBlock.data), /TITLE=Canonical Title/);
  assert.match(new TextDecoder().decode(commentBlock.data), /ARTIST=Canonical Artist/);
  assert.deepEqual(new Uint8Array(await source.arrayBuffer()), before);
});

test("existing custom Vorbis comments survive while canonical title replaces old title", async () => {
  const old = new Uint8Array(await vorbis("TITLE=Old Title", "MOOD=Happy").arrayBuffer());
  const source = file(block(0, false, info), block(4, true, old), audio);
  const out = await parseExport(source);
  const comments = new TextDecoder().decode(out.blocks.find((b) => b.type === 4).data);
  assert.match(comments, /MOOD=Happy/);
  assert.match(comments, /TITLE=Canonical Title/);
  assert.doesNotMatch(comments, /TITLE=Old Title/);
  assert.deepEqual(out.audio, audio);
});

test("oversized declared metadata block rejects instead of creating metadata-only export", async () => {
  const source = file(block(0, false, info), block(1, true, audio, 100));
  await rejectWithoutMutation(source, /Truncated FLAC metadata block/);
});

test("truncated following metadata header rejects", async () => {
  await rejectWithoutMutation(file(block(0, false, info), Uint8Array.from([0x81, 0])), /Truncated FLAC metadata header/);
});

test("missing STREAMINFO or wrong STREAMINFO size rejects", async () => {
  await rejectWithoutMutation(file(block(4, true, new Uint8Array(8)), audio), /Invalid FLAC STREAMINFO/);
  await rejectWithoutMutation(file(block(0, true, new Uint8Array(33)), audio), /Invalid FLAC STREAMINFO/);
});

test("no audio after final metadata block rejects", async () => {
  await rejectWithoutMutation(file(block(0, true, info)), /no audio bytes/);
});

test("Vorbis vendor length beyond the comment block rejects", async () => {
  const data = new Uint8Array([...le32(999), ...le32(0)]);
  await rejectWithoutMutation(file(block(0, false, info), block(4, true, data), audio), /vendor length/);
});

test("Vorbis comment count exceeding remaining length rejects", async () => {
  const data = new Uint8Array([...le32(0), ...le32(99)]);
  await rejectWithoutMutation(file(block(0, false, info), block(4, true, data), audio), /comment count/);
});

test("Vorbis comment byte length exceeding block rejects", async () => {
  const data = new Uint8Array([...le32(0), ...le32(1), ...le32(100), 65]);
  await rejectWithoutMutation(file(block(0, false, info), block(4, true, data), audio), /comment length/);
});

test("invalid FLAC signature rejects instead of silently copying an untagged file", async () => {
  await rejectWithoutMutation(new File([enc.encode("BAD!"), audio], "sample.flac"), /Invalid FLAC signature/);
});

test("new picture metadata exceeding FLAC's 24-bit block length rejects", async () => {
  const source = file(block(0, true, info), audio);
  await rejectWithoutMutation(source, /24-bit size limit/, {
    ...tags, cover: { mime: "image/jpeg", data: new Uint8Array(0x1000000) },
  });
});

test("small replacement picture keeps the audio payload and creates a picture block", async () => {
  const source = file(block(0, true, info), audio);
  const output = await tidiedCopy(source, {
    ...tags, cover: { mime: "image/png", data: Uint8Array.from([137, 80, 78, 71]) },
  });
  const bytes = new Uint8Array(await output.arrayBuffer());
  let p = 4, foundPicture = false;
  for (;;) {
    const last = (bytes[p] & 0x80) !== 0, type = bytes[p] & 0x7f;
    const n = (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3];
    if (type === 6) foundPicture = true;
    p += 4 + n;
    if (last) break;
  }
  assert.equal(foundPicture, true);
  assert.deepEqual(bytes.subarray(p), audio);
});
