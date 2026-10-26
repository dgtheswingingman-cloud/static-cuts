import { test } from "node:test";
import assert from "node:assert/strict";
import { confirmedExportIds, lookupErrorForRequest, missingCanonicalIds } from "../app/local/canonicalReady.ts";

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
