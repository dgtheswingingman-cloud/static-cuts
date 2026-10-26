import { test } from "node:test";
import assert from "node:assert/strict";
import { confirmedExportIds, lookupErrorForRequest, matchUpdatePatch, missingCanonicalIds } from "../app/local/canonicalReady.ts";

const row = (key, track_id, status = "sure") => ({ key, track_id, status });

test("only confirmed, connected recordings require canonical metadata", () => {
  const files = new Map([["a", {}], ["b", {}], ["c", {}]]);
  assert.deepEqual(confirmedExportIds([
    row("a", "confirmed"), row("b", "unconfirmed", "check"),
    row("c", "unknown", "none"), row("missing", "disconnected"),
  ], files), ["confirmed"]);
});

test("a confirmed recording without a track ID cannot use archive tags", () => {
  assert.deepEqual(confirmedExportIds([row("a", null)], new Map([["a", {}]])), []);
});

test("multiple copies of the same confirmed recording require one lookup", () => {
  assert.deepEqual(confirmedExportIds([
    row("a", "same"), row("b", "same"), row("c", "other"),
  ], new Map([["a", {}], ["b", {}], ["c", {}]])), ["same", "other"]);
});

test("confirmed recordings without fetched metadata block export", () => {
  assert.deepEqual(missingCanonicalIds(["first", "second"], { first: { title: "Track" } }), ["second"]);
});

test("all canonical rows loaded allows export", () => {
  assert.deepEqual(missingCanonicalIds(["first", "second"], { first: {}, second: {} }), []);
});

test("prototype keys do not falsely count as loaded metadata", () => {
  assert.deepEqual(missingCanonicalIds(["toString", "__proto__"], {}), ["toString", "__proto__"]);
});

test("unconfirmed-only or disconnected batches never wait for catalogue", () => {
  const ids = confirmedExportIds([row("a", "guess", "check"), row("b", "missing")], new Map([["a", {}]]));
  assert.deepEqual(missingCanonicalIds(ids, {}), []);
});

test("canonical lookup errors are shown only for their request", () => {
  const error = { requestKey: "track-1\u00011", message: "Lookup failed" };
  assert.equal(lookupErrorForRequest(error, "track-1\u00011"), "Lookup failed");
  assert.equal(lookupErrorForRequest(error, "track-1\u00012"), null);
  assert.equal(lookupErrorForRequest(error, "track-2\u00011"), null);
  assert.equal(lookupErrorForRequest(null, "track-1\u00011"), null);
});


test("changing to a different confirmed version clears stale manual tags and ownership", () => {
  const previous = { track_id: "demo", owned: true, edit: { title: "Demo Edit", artist: "Old Artist", year: "2024" } };
  assert.deepEqual(matchUpdatePatch(previous, { track_id: "official", status: "sure" }), {
    track_id: "official", status: "sure", owned: false, edit: undefined,
  });
});

test("reassigning a match to no track also removes old metadata overrides", () => {
  const previous = { track_id: "wrong", owned: true, edit: { album: "Old Album" } };
  assert.deepEqual(matchUpdatePatch(previous, { track_id: null }), {
    track_id: null, owned: false, edit: undefined,
  });
});

test("confirming the same track or changing only status preserves user edits", () => {
  const previous = { track_id: "correct", owned: false, edit: { title: "Preferred Title" } };
  assert.deepEqual(matchUpdatePatch(previous, { track_id: "correct", status: "sure" }), {
    track_id: "correct", status: "sure",
  });
  assert.deepEqual(matchUpdatePatch(previous, { status: "check" }), { status: "check" });
});

test("an initial assignment clears any stale local override while keeping the new match", () => {
  const previous = { track_id: null, owned: false, edit: { title: "Old Filename Guess" } };
  assert.deepEqual(matchUpdatePatch(previous, { track_id: "catalogue" }), {
    track_id: "catalogue", owned: false, edit: undefined,
  });
});

test("unrelated updates and missing previous item are unchanged", () => {
  const previous = { track_id: "correct", owned: false, edit: { title: "Manual" } };
  assert.deepEqual(matchUpdatePatch(previous, { reason: "Reviewed" }), { reason: "Reviewed" });
  assert.deepEqual(matchUpdatePatch(undefined, { track_id: "new" }), { track_id: "new" });
});
