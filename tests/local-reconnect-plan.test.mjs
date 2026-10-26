import { test } from "node:test";
import assert from "node:assert/strict";
import { connectedFileSignature } from "../app/local/connectedFileSignature.ts";

test("a reconnect changes the signature even when the Map object is reused", () => {
  const files = new Map();
  const before = connectedFileSignature(files);
  files.set("previously-saved", {});
  assert.notEqual(connectedFileSignature(files), before);
});

test("switching connected keys changes the signature even when count stays constant", () => {
  const files = new Map([["a", {}]]);
  const before = connectedFileSignature(files);
  files.delete("a");
  files.set("b", {});
  assert.notEqual(connectedFileSignature(files), before);
});

test("insertion order does not cause unnecessary preview invalidation", () => {
  assert.equal(connectedFileSignature(new Map([["b", {}], ["a", {}]])),
    connectedFileSignature(new Map([["a", {}], ["b", {}]])));
});

test("length-prefixed keys avoid separator ambiguity", () => {
  assert.notEqual(connectedFileSignature(new Map([["a|1:b", {}]])),
    connectedFileSignature(new Map([["a", {}], ["b", {}]])));
});

test("replacing a connected File value does not change the key-only preview plan", () => {
  const files = new Map([["a", { name: "first" }]]);
  const before = connectedFileSignature(files);
  files.set("a", { name: "second" });
  assert.equal(connectedFileSignature(files), before);
});
