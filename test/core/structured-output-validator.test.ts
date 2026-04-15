import assert from "node:assert/strict";
import test from "node:test";

import { StructuredOutputValidator } from "../../src/core/structured-output-validator.ts";

const DEFAULT_HUNK_HEADER = "@@ -20,2 +20,4 @@";
const DEFAULT_DIFF = [DEFAULT_HUNK_HEADER, "-old()", "+new()"].join("\n");

function lineRangeTraceability(lineStart: unknown, lineEnd: unknown) {
  return {
    kind: "line-range",
    lineStart,
    lineEnd
  };
}

function diffHunkTraceability(hunkHeader: unknown) {
  return {
    kind: "diff-hunk",
    hunkHeader
  };
}

function finding(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "must",
    title: "問題標題",
    traceability: lineRangeTraceability(14, 18),
    context: "具體情境",
    deviation: "預期與實際有落差",
    impact: "會造成 correctness 問題",
    suggestion: "補上 guard",
    confidence: 88,
    ...overrides
  };
}

function payload(findings: unknown[]): string {
  return JSON.stringify({ findings });
}

function validate(input: {
  responseText: string;
  diffContent?: string;
}) {
  return new StructuredOutputValidator().validate({
    responseText: input.responseText,
    ...(input.diffContent === undefined ? {} : { diffContent: input.diffContent })
  });
}

function validateAndFilter(input: {
  responseText: string;
  diffContent?: string;
  thresholds?: { must: number; nice: number };
}) {
  const validator = new StructuredOutputValidator(
    input.thresholds === undefined
      ? {}
      : { confidenceThresholds: input.thresholds }
  );
  const payload = validator.validate({
    responseText: input.responseText,
    ...(input.diffContent === undefined ? {} : { diffContent: input.diffContent })
  });

  return validator.filterByConfidence(payload);
}

function assertValidationFails(input: {
  responseText: string;
  diffContent?: string;
  label?: string;
}): void {
  assert.throws(
    () =>
      new StructuredOutputValidator().validate({
        responseText: input.responseText,
        ...(input.diffContent === undefined ? {} : { diffContent: input.diffContent })
      }),
    /deterministic validation failed/u,
    input.label
  );
}

test("StructuredOutputValidator accepts schema-valid findings JSON", () => {
  const validFinding = finding();

  assert.deepEqual(validate({ responseText: payload([validFinding]) }), {
    findings: [validFinding]
  });
});

test("StructuredOutputValidator rejects malformed JSON and extra non-JSON text", () => {
  for (const testCase of [
    {
      label: "malformed JSON",
      responseText: "{\"findings\":[}"
    },
    {
      label: "trailing text after JSON",
      responseText: "{\"findings\": []}\nextra trailing text"
    }
  ]) {
    assertValidationFails(testCase);
  }
});

test("StructuredOutputValidator rejects invalid top-level payload shapes", () => {
  for (const testCase of [
    { label: "array top-level", value: [] },
    { label: "missing findings field", value: {} },
    { label: "non-array findings field", value: { findings: {} } }
  ]) {
    assertValidationFails({
      label: testCase.label,
      responseText: JSON.stringify(testCase.value)
    });
  }
});

test("StructuredOutputValidator rejects schema-invalid findings payloads", () => {
  const cases: Array<{
    label: string;
    invalidFinding: Record<string, unknown>;
  }> = [
    {
      label: "empty title",
      invalidFinding: finding({ title: "" })
    },
    {
      label: "missing confidence",
      invalidFinding: finding({ confidence: undefined })
    },
    {
      label: "confidence above 100",
      invalidFinding: finding({ confidence: 101 })
    },
    {
      label: "string confidence",
      invalidFinding: finding({ confidence: "88" })
    }
  ];

  for (const testCase of cases) {
    assertValidationFails({
      label: testCase.label,
      responseText: payload([testCase.invalidFinding])
    });
  }
});

test("StructuredOutputValidator validate returns all structurally valid findings without filtering", () => {
  const mustAbove = finding({
    type: "must",
    title: "must above threshold",
    traceability: lineRangeTraceability(10, 12),
    confidence: 80
  });
  const mustBelow = finding({
    type: "must",
    title: "must below threshold",
    traceability: lineRangeTraceability(15, 15),
    confidence: 50
  });

  assert.deepEqual(
    validate({
      responseText: payload([mustAbove, mustBelow])
    }),
    { findings: [mustAbove, mustBelow] }
  );
});

test("StructuredOutputValidator filterByConfidence filters findings by default confidence thresholds", () => {
  const keptMust = finding({
    type: "must",
    title: "保留 must",
    traceability: lineRangeTraceability(10, 12),
    impact: "影響 correctness",
    confidence: 80
  });
  const keptNice = finding({
    type: "nice",
    title: "保留 nice",
    traceability: diffHunkTraceability(DEFAULT_HUNK_HEADER),
    deviation: "可再調整",
    impact: "影響可維護性",
    suggestion: "補上整理",
    confidence: 90
  });

  assert.deepEqual(
    validateAndFilter({
      responseText: payload([
        keptMust,
        finding({
          type: "must",
          title: "移除 must",
          traceability: lineRangeTraceability(15, 15),
          impact: "影響 correctness",
          confidence: 79
        }),
        keptNice,
        finding({
          type: "nice",
          title: "移除 nice",
          traceability: lineRangeTraceability(30, 31),
          deviation: "可再調整",
          impact: "影響可維護性",
          suggestion: "補上整理",
          confidence: 89
        })
      ]),
      diffContent: DEFAULT_DIFF
    }),
    { findings: [keptMust, keptNice] }
  );
});

test("StructuredOutputValidator filterByConfidence filters findings by supplied confidence thresholds", () => {
  const keptMust = finding({
    type: "must",
    title: "保留 must",
    traceability: lineRangeTraceability(3, 3),
    impact: "影響 correctness",
    confidence: 70
  });
  const keptNice = finding({
    type: "nice",
    title: "保留 nice",
    traceability: lineRangeTraceability(8, 10),
    deviation: "可再調整",
    impact: "影響可維護性",
    suggestion: "補上整理",
    confidence: 85
  });
  const customHunkHeader = "@@ -30,1 +30,2 @@";

  assert.deepEqual(
    validateAndFilter({
      responseText: payload([
        keptMust,
        finding({
          type: "must",
          title: "移除 must",
          traceability: lineRangeTraceability(4, 5),
          impact: "影響 correctness",
          confidence: 69
        }),
        keptNice,
        finding({
          type: "nice",
          title: "移除 nice",
          traceability: diffHunkTraceability(customHunkHeader),
          deviation: "可再調整",
          impact: "影響可維護性",
          suggestion: "補上整理",
          confidence: 84
        })
      ]),
      diffContent: `${customHunkHeader}\n-old\n+new\n`,
      thresholds: { must: 70, nice: 85 }
    }),
    { findings: [keptMust, keptNice] }
  );
});

test("StructuredOutputValidator accepts an empty findings array", () => {
  assert.deepEqual(validate({ responseText: payload([]) }), { findings: [] });
});

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
      label: "diff-hunk header is unknown",
      invalidFinding: finding({
        traceability: diffHunkTraceability("@@ -40,2 +40,3 @@")
      }),
      diffContent: "@@ -1 +1 @@\n-old\n+new\n"
    },
    {
      label: "diff-hunk missing hunkHeader",
      invalidFinding: finding({ traceability: { kind: "diff-hunk" } }),
      diffContent: "@@ -1 +1 @@\n-old\n+new\n"
    },
    {
      label: "diff has no hunk headers",
      invalidFinding: finding({
        traceability: diffHunkTraceability("@@ -1 +1 @@")
      }),
      diffContent: "diff --git a/src/app.ts b/src/app.ts\nindex 123..456 100644\n"
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
