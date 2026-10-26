import { test } from "node:test";
import assert from "node:assert/strict";
import { formatFolderSegments, formatTemplate, sourceExtension, templateError } from "../app/local/formatTemplate.ts";

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

test("canonical title punctuation at both boundaries survives layout formatting", () => {
  assert.equal(formatTemplate("{title}", { ...v, title: "- Intro" }), "- Intro");
  assert.equal(formatTemplate("{title}", { ...v, title: "Track -" }), "Track -");
  assert.equal(formatTemplate("{artist} - {title}", { ...v, title: "- Intro" }), "Example Artist - - Intro");
});
test("canonical title whitespace is not normalized by the template renderer", () => {
  assert.equal(formatTemplate("{title}", { ...v, title: "A  B" }), "A  B");
  assert.equal(formatTemplate("{artist} - {title}", { ...v, title: "A  B" }), "Example Artist - A  B");
});
test("empty metadata still removes only template separators", () => {
  assert.equal(formatTemplate("{artist} - {title}", { ...v, artist: "" }), "Unreleased Track");
  assert.equal(formatTemplate("{title} - {year}", { ...v, year: "" }), "Unreleased Track");
});

// Folder structure must be derived from the template, not from slash characters
// inside canonical metadata values. Missing optional levels must not become
// an unexpected "Untitled" directory via safeName().
test("folder levels come from the template, not canonical artist slashes", () => {
  assert.deepEqual(formatFolderSegments("{artist}/{album}", { ...v, artist: "AC/DC" }), ["AC/DC", "Unreleased"]);
});
test("canonical album slashes stay inside a single folder level", () => {
  assert.deepEqual(formatFolderSegments("{artist}/{album}", { ...v, album: "A/B" }), ["Example Artist", "A/B"]);
});
test("missing album and year omit empty folder levels", () => {
  assert.deepEqual(formatFolderSegments("{artist}/{album} - {year}", { ...v, album: "", year: "" }), ["Example Artist"]);
  assert.deepEqual(formatFolderSegments("{artist}/{album}/{year}", { ...v, album: "", year: "" }), ["Example Artist"]);
});
test("repeated separators and blank folder template create no empty levels", () => {
  assert.deepEqual(formatFolderSegments("{artist}//{title}", v), ["Example Artist", "Unreleased Track"]);
  assert.deepEqual(formatFolderSegments("", v), []);
});
test("canonical punctuation inside folder values is preserved for sanitization", () => {
  assert.deepEqual(formatFolderSegments("{artist}/{album}", { ...v, album: "- EP" }), ["Example Artist", "- EP"]);
});

// A browser can accept an extensionless File when its MIME type is audio/*.
// Local Cuts must not label unchanged bytes as MPEG by guessing '.mp3'.
test("extensionless audio keeps no suffix rather than a fabricated MP3 suffix", () => {
  assert.equal(sourceExtension("recording"), "");
  assert.equal(sourceExtension("live take"), "");
});
test("existing audio extensions survive renaming without transcoding", () => {
  assert.equal(sourceExtension("track.MP3"), ".mp3");
  assert.equal(sourceExtension("track.FLAC"), ".flac");
  assert.equal(sourceExtension("track.m4a"), ".m4a");
  assert.equal(sourceExtension("track.wav"), ".wav");
});
test("unusual or long suffixes are not silently replaced with MP3", () => {
  assert.equal(sourceExtension("recording.unknown"), "");
  assert.equal(sourceExtension("recording.foo"), ".foo");
});
