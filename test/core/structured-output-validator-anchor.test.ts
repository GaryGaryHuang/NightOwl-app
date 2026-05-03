import assert from "node:assert/strict";
import test from "node:test";

import { StructuredOutputValidator } from "../../src/core/structured-output-validator.ts";
import {
  DEFAULT_DIFF,
  DEFAULT_HUNK_HEADER,
  assertValidationFails,
  diffHunkTraceability,
  finding,
  lineRangeTraceability,
  payload,
  validate
} from "../helpers/structured-output-validator-fixture.ts";

test("StructuredOutputValidator rejects invalid traceability payloads", () => {
  const cases: Array<{
    label: string;
    invalidFinding: Record<string, unknown>;
    diffContent?: string;
  }> = [
    {
      label: "missing traceability",
      invalidFinding: finding({ traceability: undefined })
    },
    {
      label: "unsupported traceability kind",
      invalidFinding: finding({
        traceability: { kind: "file-offset", offsetStart: 1, offsetEnd: 2 }
      })
    },
    {
      label: "line-range inverted bounds",
      invalidFinding: finding({ traceability: lineRangeTraceability(20, 19) })
    },
    {
      label: "lineStart is zero",
      invalidFinding: finding({ traceability: lineRangeTraceability(0, 5) })
    },
    {
      label: "lineEnd is negative",
      invalidFinding: finding({ traceability: lineRangeTraceability(1, -1) })
    },
    {
      label: "diff-hunk missing hunkHeader",
      invalidFinding: finding({ traceability: { kind: "diff-hunk" } }),
      diffContent: "@@ -1 +1 @@\n-old\n+new\n"
    }
  ];

  for (const testCase of cases) {
    assertValidationFails({
      label: testCase.label,
      responseText: payload([testCase.invalidFinding]),
      ...(testCase.diffContent === undefined ? {} : { diffContent: testCase.diffContent })
    });
  }
});

test("StructuredOutputValidator accepts line-range outside changed head lines", () => {
  const offsetFinding = finding({
    traceability: lineRangeTraceability(14, 18)
  });

  const result = new StructuredOutputValidator().validate({
    responseText: payload([offsetFinding]),
    diffContent: DEFAULT_DIFF,
    filePath: "src/foo.ts"
  });

  assert.equal(result.findings.length, 1);
  assert.deepEqual(result.findings[0].traceability, {
    kind: "line-range",
    lineStart: 14,
    lineEnd: 18
  });
});

test("StructuredOutputValidator accepts line-range inside hunk span when it misses all changed lines", () => {
  const unchangedSpanFinding = finding({
    traceability: lineRangeTraceability(23, 23)
  });

  const result = new StructuredOutputValidator().validate({
    responseText: payload([unchangedSpanFinding]),
    diffContent: DEFAULT_DIFF,
    filePath: "src/foo.ts"
  });

  assert.equal(result.findings.length, 1);
  assert.deepEqual(result.findings[0].traceability, {
    kind: "line-range",
    lineStart: 23,
    lineEnd: 23
  });
});

test("StructuredOutputValidator accepts diff-hunk with trimmed header through anchor verifier", () => {
  const trimmedHeaderFinding = finding({
    traceability: diffHunkTraceability(`  ${DEFAULT_HUNK_HEADER}  `)
  });

  const result = new StructuredOutputValidator().validate({
    responseText: payload([trimmedHeaderFinding]),
    diffContent: DEFAULT_DIFF,
    filePath: "src/foo.ts"
  });

  assert.deepEqual(result.findings[0].traceability, {
    kind: "diff-hunk",
    hunkHeader: DEFAULT_HUNK_HEADER
  });
});

test("StructuredOutputValidator accepts unknown diff-hunk header when diffContent is supplied", () => {
  const unknownHunkFinding = finding({
    traceability: diffHunkTraceability("@@ -40,2 +40,3 @@")
  });

  const result = new StructuredOutputValidator().validate({
    responseText: payload([unknownHunkFinding]),
    diffContent: DEFAULT_DIFF,
    filePath: "src/foo.ts"
  });

  assert.equal(result.findings.length, 1);
  assert.deepEqual(result.findings[0].traceability, {
    kind: "diff-hunk",
    hunkHeader: "@@ -40,2 +40,3 @@"
  });
});

test("StructuredOutputValidator accepts diff-hunk when diff has no hunk headers", () => {
  const unknownHunkFinding = finding({
    traceability: diffHunkTraceability("@@ -1 +1 @@")
  });

  const result = new StructuredOutputValidator().validate({
    responseText: payload([unknownHunkFinding]),
    diffContent: "diff --git a/src/app.ts b/src/app.ts\nindex 123..456 100644\n",
    filePath: "src/foo.ts"
  });

  assert.equal(result.findings.length, 1);
});

test("StructuredOutputValidator accepts line-range outside changed lines when dependencyPathException is supplied", () => {
  const exceptionFinding = finding({
    traceability: lineRangeTraceability(14, 18),
    dependencyPathException: {
      reason: "called from changed initializer",
      dependencyAnchor: {
        filePath: "src/dep.ts",
        symbol: "bootstrap"
      }
    }
  });

  const result = new StructuredOutputValidator().validate({
    responseText: payload([exceptionFinding]),
    diffContent: DEFAULT_DIFF,
    filePath: "src/foo.ts"
  });

  assert.equal(result.findings.length, 1);
  assert.deepEqual(result.findings[0].dependencyPathException, {
    reason: "called from changed initializer",
    dependencyAnchor: {
      filePath: "src/dep.ts",
      symbol: "bootstrap"
    }
  });
});

test("StructuredOutputValidator rejects dependencyPathException with empty reason", () => {
  const bad = finding({
    traceability: lineRangeTraceability(14, 18),
    dependencyPathException: {
      reason: "",
      dependencyAnchor: { filePath: "src/dep.ts" }
    }
  });

  assertValidationFails({
    responseText: payload([bad]),
    diffContent: DEFAULT_DIFF
  });
});

test("StructuredOutputValidator rejects dependencyPathException with empty dependencyAnchor.filePath", () => {
  const bad = finding({
    traceability: lineRangeTraceability(14, 18),
    dependencyPathException: {
      reason: "ok",
      dependencyAnchor: { filePath: "" }
    }
  });

  assertValidationFails({
    responseText: payload([bad]),
    diffContent: DEFAULT_DIFF
  });
});

test("StructuredOutputValidator rejects dependencyPathException with empty dependencyAnchor.symbol", () => {
  const bad = finding({
    traceability: lineRangeTraceability(14, 18),
    dependencyPathException: {
      reason: "ok",
      dependencyAnchor: {
        filePath: "src/dep.ts",
        symbol: ""
      }
    }
  });

  assert.throws(
    () =>
      new StructuredOutputValidator().validate({
        responseText: payload([bad]),
        diffContent: DEFAULT_DIFF
      }),
    /deterministic validation failed: 'dependencyPathException\.dependencyAnchor\.symbol' must be a non-empty string/u
  );
});

test("StructuredOutputValidator rejects unknown fields in dependencyPathException", () => {
  assertValidationFails({
    responseText: payload([
      finding({
        traceability: lineRangeTraceability(14, 18),
        dependencyPathException: {
          reason: "called from changed initializer",
          dependencyAnchor: { filePath: "src/dep.ts" },
          extra: true
        }
      })
    ]),
    diffContent: DEFAULT_DIFF
  });
});

test("StructuredOutputValidator rejects unknown fields in dependencyAnchor", () => {
  assertValidationFails({
    responseText: payload([
      finding({
        traceability: lineRangeTraceability(14, 18),
        dependencyPathException: {
          reason: "called from changed initializer",
          dependencyAnchor: { filePath: "src/dep.ts", extra: true }
        }
      })
    ]),
    diffContent: DEFAULT_DIFF
  });
});

test("StructuredOutputValidator falls back to legacy line-range check when diffContent is omitted", () => {
  const noDiffFinding = finding({
    traceability: lineRangeTraceability(14, 18)
  });

  assert.deepEqual(validate({ responseText: payload([noDiffFinding]) }), {
    schemaVersion: 2,
    findings: [noDiffFinding]
  });
});
