import assert from "node:assert/strict";
import test from "node:test";

import { buildFindingAnchorPromptContext } from "../../src/core/finding-anchor-context.ts";

test("buildFindingAnchorPromptContext centralizes the diff-derived prompt context", () => {
  const context = buildFindingAnchorPromptContext(
    "src/foo.ts",
    [
      "@@ -20,2 +20,4 @@",
      " context-a",
      "+added-one",
      "+added-two",
      " context-b"
    ].join("\n")
  );

  assert.equal(context.filePath, "src/foo.ts");
  assert.equal(context.diffAnchorMap.filePath, "src/foo.ts");
  assert.equal(context.diffAnchorMap.hunks.length, 1);

  const [hunk] = context.diffAnchorMap.hunks;
  assert.equal(hunk.hunkHeader, "@@ -20,2 +20,4 @@");
  assert.equal(hunk.headLineStart, 20);
  assert.equal(hunk.headLineEnd, 23);
  assert.deepEqual([...hunk.changedHeadLines].sort((a, b) => a - b), [21, 22]);
});
