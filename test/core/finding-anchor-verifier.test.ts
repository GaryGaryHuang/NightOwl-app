import assert from "node:assert/strict";
import test from "node:test";

import type { DependencyPathException } from "../../src/core/file-review-context.ts";
import { buildFindingAnchorValidationContext } from "../../src/core/finding-anchor-context.ts";
import {
  ANCHOR_FAILURE_TAG,
  verifyFindingAnchor
} from "../../src/core/finding-anchor-verifier.ts";

const DIFF = [
  "@@ -20,2 +20,4 @@",
  " ctx",
  "+added-21",
  "+added-22",
  " ctx"
].join("\n");

const ANCHOR_CONTEXT = buildFindingAnchorValidationContext("src/foo.ts", DIFF);

const STRUCTURAL_EXCEPTION_WITH_SYMBOL: DependencyPathException = {
  reason: "called from changed initializer",
  dependencyAnchor: {
    filePath: "src/dep.ts",
    symbol: "bootstrap"
  }
};

test("line-range overlapping a changed head line passes verification", () => {
  const result = verifyFindingAnchor({
    traceability: { kind: "line-range", lineStart: 20, lineEnd: 22 },
    anchorContext: ANCHOR_CONTEXT
  });

  assert.deepEqual(result, { ok: true });
});

test("line-range fully outside any changed head line fails with ANCHOR tag", () => {
  const result = verifyFindingAnchor({
    traceability: { kind: "line-range", lineStart: 14, lineEnd: 18 },
    anchorContext: ANCHOR_CONTEXT
  });

  assert.equal(result.ok, false);
  assert.equal(result.ok ? null : result.tag, ANCHOR_FAILURE_TAG);
  assert.equal(
    result.ok ? null : result.reason,
    "line-range-outside-changed-lines"
  );
  assert.match(
    result.ok ? "" : result.detail,
    /line range 14-18.*src\/foo\.ts/u
  );
});

test("dependency-path exception structural shape with optional symbol bypasses overlap", () => {
  const result = verifyFindingAnchor({
    traceability: { kind: "line-range", lineStart: 14, lineEnd: 18 },
    anchorContext: ANCHOR_CONTEXT,
    dependencyPathException: STRUCTURAL_EXCEPTION_WITH_SYMBOL
  });

  assert.deepEqual(result, { ok: true });
});

test("diff-hunk with known header passes verification", () => {
  const result = verifyFindingAnchor({
    traceability: { kind: "diff-hunk", hunkHeader: "@@ -20,2 +20,4 @@" },
    anchorContext: ANCHOR_CONTEXT
  });

  assert.deepEqual(result, { ok: true });
});

test("diff-hunk with unknown header fails verification with ANCHOR tag", () => {
  const result = verifyFindingAnchor({
    traceability: { kind: "diff-hunk", hunkHeader: "@@ -1,1 +1,1 @@" },
    anchorContext: ANCHOR_CONTEXT
  });

  assert.equal(result.ok, false);
  assert.equal(result.ok ? null : result.tag, ANCHOR_FAILURE_TAG);
  assert.equal(result.ok ? null : result.reason, "unknown-hunk-header");
});

test("line-range below headLineStart fails when no exception", () => {
  const result = verifyFindingAnchor({
    traceability: { kind: "line-range", lineStart: 1, lineEnd: 5 },
    anchorContext: ANCHOR_CONTEXT
  });

  assert.equal(result.ok, false);
});

test("line-range inside hunk span but outside changed lines still fails", () => {
  const result = verifyFindingAnchor({
    traceability: { kind: "line-range", lineStart: 23, lineEnd: 23 },
    anchorContext: ANCHOR_CONTEXT
  });

  assert.equal(result.ok, false);
  assert.equal(
    result.ok ? null : result.reason,
    "line-range-outside-changed-lines"
  );
});

test("line-range partially overlapping first changed line passes", () => {
  const result = verifyFindingAnchor({
    traceability: { kind: "line-range", lineStart: 18, lineEnd: 21 },
    anchorContext: ANCHOR_CONTEXT
  });

  assert.deepEqual(result, { ok: true });
});

test("line-range matching changed line in second hunk passes", () => {
  const multi = buildFindingAnchorValidationContext(
    "src/multi.ts",
    [
      "@@ -1,1 +1,1 @@",
      " keep",
      "@@ -50,1 +60,2 @@",
      " keep",
      "+late"
    ].join("\n")
  );

  const result = verifyFindingAnchor({
    traceability: { kind: "line-range", lineStart: 60, lineEnd: 62 },
    anchorContext: multi
  });

  assert.deepEqual(result, { ok: true });
});

test("diff-hunk header comparison trims whitespace", () => {
  const result = verifyFindingAnchor({
    traceability: {
      kind: "diff-hunk",
      hunkHeader: "  @@ -20,2 +20,4 @@  "
    },
    anchorContext: ANCHOR_CONTEXT
  });

  assert.deepEqual(result, { ok: true });
});
