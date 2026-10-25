import { test } from "node:test";
import assert from "node:assert/strict";
import { assessVersion } from "../app/local/versionMatch.ts";
const family = [
  { id: "main", title: "Cold Night", parent_track_id: null },
  { id: "v2", title: "Cold Night (V2)", parent_track_id: "main" },
  { id: "demo", title: "Cold Night (Demo)", parent_track_id: "main" },
];
test("explicit version is suggested, never confirmed", () => {
  const result = assessVersion("Artist - Cold Night (V2).mp3", "Cold Night", "Artist", family);
  assert.equal(result.candidate?.id, "v2");
  assert.match(result.reason, /Confirm the recording/);
});
test("base title never identifies the actual recording", () => {
  const result = assessVersion("Artist - Cold Night.mp3", "Cold Night", "Artist", family);
  assert.equal(result.candidate, null);
  assert.match(result.reason, /linked song\/version/);
});
test("duplicate version names require manual review", () => {
  const result = assessVersion("Cold Night (V2).mp3", null, null, [...family, { id: "dup", title: "Cold Night (V2)", parent_track_id: "main" }]);
  assert.equal(result.candidate, null);
});
test("incomplete version retrieval requires manual review", () => {
  assert.equal(assessVersion("Cold Night (V2).mp3", null, null, family, false).candidate, null);
});
test("single main recording still requires confirmation", () => {
  assert.equal(assessVersion("Cold Night.mp3", "Cold Night", null, [family[0]]).candidate, null);
});
test("similar but different version label is never an exact suggestion", () => {
  assert.equal(assessVersion("Cold Night (Demo V2).mp3", "Cold Night", null, family).candidate, null);
});
test("explicit demo filename suggests demo", () => {
  assert.equal(assessVersion("Artist - Cold Night [Demo].flac", "Cold Night", "Artist", family).candidate?.id, "demo");
});
