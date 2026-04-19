import assert from "node:assert/strict";
import test from "node:test";

import { buildDiffAnchorMap } from "../../src/core/diff-anchor-map.ts";

test("buildDiffAnchorMap parses standard hunk header into head range and changed-line set", () => {
  const diff = [
    "@@ -20,2 +20,4 @@",
    " context-a",
    "+added-one",
    "+added-two",
    " context-b"
  ].join("\n");

  const map = buildDiffAnchorMap("src/foo.ts", diff);

  assert.equal(map.filePath, "src/foo.ts");
  assert.equal(map.hunks.length, 1);

  const [hunk] = map.hunks;
  assert.equal(hunk.hunkHeader, "@@ -20,2 +20,4 @@");
  assert.equal(hunk.headLineStart, 20);
  assert.equal(hunk.headLineEnd, 23);
  assert.deepEqual([...hunk.changedHeadLines].sort((a, b) => a - b), [21, 22]);
});

test("buildDiffAnchorMap handles multiple hunks", () => {
  const diff = [
    "@@ -1,2 +1,3 @@",
    " keep",
    "+inserted",
    " keep",
    "@@ -50,1 +60,2 @@",
    " keep",
    "+late"
  ].join("\n");

  const map = buildDiffAnchorMap("src/bar.ts", diff);

  assert.equal(map.hunks.length, 2);
  assert.deepEqual(
    [...map.hunks[0].changedHeadLines].sort((a, b) => a - b),
    [2]
  );
  assert.equal(map.hunks[1].headLineStart, 60);
  assert.equal(map.hunks[1].headLineEnd, 61);
  assert.deepEqual(
    [...map.hunks[1].changedHeadLines].sort((a, b) => a - b),
    [61]
  );
});

test("buildDiffAnchorMap treats pure deletion hunk as empty changed-head-lines", () => {
  const diff = [
    "@@ -10,3 +10,0 @@",
    "-removed-1",
    "-removed-2",
    "-removed-3"
  ].join("\n");

  const map = buildDiffAnchorMap("src/del.ts", diff);

  assert.equal(map.hunks.length, 1);
  const [hunk] = map.hunks;
  assert.equal(hunk.headLineStart, 10);
  assert.equal(hunk.headLineEnd, 10);
  assert.equal(hunk.changedHeadLines.size, 0);
});

test("buildDiffAnchorMap skips no-newline marker lines", () => {
  const diff = [
    "@@ -1,1 +1,2 @@",
    "+first",
    "+second",
    "\\ No newline at end of file"
  ].join("\n");

  const map = buildDiffAnchorMap("src/nl.ts", diff);

  assert.equal(map.hunks.length, 1);
  assert.deepEqual(
    [...map.hunks[0].changedHeadLines].sort((a, b) => a - b),
    [1, 2]
  );
});

test("buildDiffAnchorMap handles header without explicit head count (defaults to 1)", () => {
  const diff = ["@@ -5 +7 @@", "+only"].join("\n");

  const map = buildDiffAnchorMap("src/single.ts", diff);

  assert.equal(map.hunks.length, 1);
  assert.equal(map.hunks[0].headLineStart, 7);
  assert.equal(map.hunks[0].headLineEnd, 7);
  assert.deepEqual([...map.hunks[0].changedHeadLines], [7]);
});

test("buildDiffAnchorMap returns empty hunk array for empty or unrecognized input", () => {
  assert.deepEqual(buildDiffAnchorMap("a.ts", "").hunks, []);
  assert.deepEqual(
    buildDiffAnchorMap("a.ts", "Binary files differ\n").hunks,
    []
  );
  assert.deepEqual(buildDiffAnchorMap("a.ts", "random text\n").hunks, []);
});

test("buildDiffAnchorMap trims header whitespace", () => {
  const diff = ["  @@ -1,1 +1,1 @@  ", "+x"].join("\n");

  const map = buildDiffAnchorMap("a.ts", diff);

  assert.equal(map.hunks.length, 1);
  assert.equal(map.hunks[0].hunkHeader, "@@ -1,1 +1,1 @@");
});
