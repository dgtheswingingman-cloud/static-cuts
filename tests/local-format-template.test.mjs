import { test } from "node:test";
import assert from "node:assert/strict";
import { formatTemplate, templateError } from "../app/local/formatTemplate.ts";

const v = { artist: "Example Artist", title: "Unreleased Track", album: "Unreleased", year: "2026", track: "03" };
test("canonical default filename and folder presets remain unchanged", () => {
  assert.equal(formatTemplate("{artist} - {title}", v), "Example Artist - Unreleased Track");
  assert.equal(formatTemplate("{artist}/{album}", v), "Example Artist/Unreleased");
});
test("custom templates include user-selected album, year and track tokens", () => {
  assert.equal(formatTemplate("{track} - {title} [{year}]", v), "03 - Unreleased Track [2026]");
  assert.equal(formatTemplate("{artist}/{year}/{album}", v), "Example Artist/2026/Unreleased");
});
test("missing year leaves no empty bracket suffix", () => {
  assert.equal(formatTemplate("{artist} - {title} ({year})", { ...v, year: "" }), "Example Artist - Unreleased Track");
  assert.equal(formatTemplate("{artist}/{album} - {year}", { ...v, year: "" }), "Example Artist/Unreleased");
});
test("canonical titles with literal empty brackets are preserved", () => {
  assert.equal(formatTemplate("{title}", { ...v, title: "Track () [Live]" }), "Track () [Live]");
  assert.equal(formatTemplate("{title} [{year}]", { ...v, title: "Track []", year: "" }), "Track []");
});
test("custom blank folder template is valid but filename must be nonempty", () => {
  assert.equal(templateError("", true), null);
  assert.match(templateError(""), /filename/);
});
test("unknown or misspelled placeholders are rejected instead of silently disappearing", () => {
  assert.match(templateError("{artist} - {titel}"), /Unknown placeholder/);
  assert.match(templateError("{title} {cover}"), /Unknown placeholder/);
});
test("malformed braces are rejected", () => {
  assert.match(templateError("{artist - {title}"), /Unmatched brace/);
  assert.match(templateError("{title}}"), /Unmatched brace/);
});
test("oversized or control-character templates are rejected", () => {
  assert.match(templateError("x".repeat(161)), /too long/);
  assert.match(templateError("{title}\n"), /control character/);
});
test("literal text can be mixed with canonical tokens", () => {
  assert.equal(formatTemplate("Archive - {artist} - {title}", v), "Archive - Example Artist - Unreleased Track");
  assert.equal(templateError("Archive - {artist} - {title}"), null);
});
