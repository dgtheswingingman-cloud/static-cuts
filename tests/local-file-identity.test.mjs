import { test } from "node:test";
import assert from "node:assert/strict";
import { fileKey, filePath, unusedKey } from "../app/local/fileIdentity.ts";

test("same recording produces stable key even when the file object changes", async () => {
  const first = new File(["sample audio"], "demo.mp3", { lastModified: 100 });
  const again = new File(["sample audio"], "demo.mp3", { lastModified: 999 });
  assert.equal(await fileKey(first), await fileKey(again));
});
test("different audio of equal filename and equal size never collapses into one key", async () => {
  const a = new File(["audioA"], "demo.mp3", { lastModified: 100 });
  const b = new File(["audioB"], "demo.mp3", { lastModified: 100 });
  assert.notEqual(await fileKey(a), await fileKey(b));
});
test("same file name in different subfolders gets a separate key", async () => {
  const a = new File(["x"], "demo.mp3");
  const b = new File(["x"], "demo.mp3");
  Object.defineProperty(a, "webkitRelativePath", { value: "Artist A/demo.mp3" });
  Object.defineProperty(b, "webkitRelativePath", { value: "Artist B/demo.mp3" });
  assert.notEqual(filePath(a), filePath(b));
  assert.notEqual(await fileKey(a), await fileKey(b));
});
test("key suffixes preserve distinct items in an otherwise identical selection", () => {
  const reserved = new Set(["key", "key#2"]);
  assert.equal(unusedKey("key", reserved), "key#3");
  assert.equal(unusedKey("other", reserved), "other");
});
test("large files only sample the beginning and end", async () => {
  const audio = new File([new Uint8Array(1024 * 1024)], "large.flac");
  const key = await fileKey(audio);
  assert.match(key, /^v1\\|large.flac\\|1048576\\|[a-f0-9]{32}$/);
});
