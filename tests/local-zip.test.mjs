import { test } from "node:test";
import assert from "node:assert/strict";
import { makeZip } from "../app/local/write.ts";

test("ZIP stores UTF-8 paths, valid CRC, and both payloads", async () => {
  const seen = [];
  const zip = await makeZip([
    { path: "Static Cuts/hello.txt", blob: new Blob(["hello world"]) },
    { path: "Static Cuts/café.txt", blob: new Blob([new Uint8Array([0, 1, 2, 255])]) },
  ], (i) => seen.push(i));
  assert.deepEqual(seen, [1, 2]);
  const bytes = Buffer.from(await zip.arrayBuffer());
  assert.equal(bytes.readUInt32LE(0), 0x04034b50);
  assert.equal(bytes.readUInt32LE(14), 0x0d4a1185); // CRC32 of "hello world"
  const nameLen = bytes.readUInt16LE(26);
  assert.equal(bytes.subarray(30, 30 + nameLen).toString(), "Static Cuts/hello.txt");
  assert.equal(bytes.subarray(30 + nameLen, 30 + nameLen + 11).toString(), "hello world");
  const end = bytes.length - 22;
  assert.equal(bytes.readUInt32LE(end), 0x06054b50);
  assert.equal(bytes.readUInt16LE(end + 10), 2);
  const cdOffset = bytes.readUInt32LE(end + 16);
  assert.equal(bytes.readUInt32LE(cdOffset), 0x02014b50);
});

test("ZIP streams source blobs instead of reading them all into an arrayBuffer", async () => {
  const blob = new Blob(["large-ish source"]);
  blob.arrayBuffer = () => { throw new Error("full blob read forbidden"); };
  const zip = await makeZip([{ path: "song.mp3", blob }]);
  assert.ok(zip.size > blob.size);
});

test("ZIP rejects oversized file and total size before reading", async () => {
  const oversized = { size: 0x100000000, stream: () => { throw Error("must not stream"); } };
  await assert.rejects(makeZip([{ path: "huge.mp3", blob: oversized }]), /4 GB ZIP limit/);
  const large = { size: 0x80000000, stream: () => { throw Error("must not stream"); } };
  await assert.rejects(makeZip([{ path: "a.mp3", blob: large }, { path: "b.mp3", blob: large }]), /ZIP exceeds the 4 GB limit/);
});

test("ZIP rejects too many entries and excessively long paths", async () => {
  const empty = new Blob([]);
  await assert.rejects(makeZip(Array.from({ length: 65536 }, () => ({ path: "x", blob: empty }))), /Too many files/);
  await assert.rejects(makeZip([{ path: "x".repeat(65536), blob: empty }]), /filename is too long/);
});
