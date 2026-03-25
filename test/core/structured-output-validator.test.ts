import assert from "node:assert/strict";
import test from "node:test";

import { StructuredOutputValidator } from "../../src/core/structured-output-validator.ts";

test("StructuredOutputValidator accepts schema-valid findings JSON", () => {
  const validator = new StructuredOutputValidator();

  const result = validator.validate({
    validatorId: "findings-json",
    responseText: JSON.stringify({
      findings: [
        {
          type: "must",
          title: "問題標題",
          traceability: lineRangeTraceability(14, 18),
          context: "具體情境",
          deviation: "預期與實際有落差",
          impact: "會造成 correctness 問題",
          suggestion: "補上 guard",
          confidence: 88
        }
      ]
    })
  });

  assert.deepEqual(result, {
    findings: [
      {
        type: "must",
        title: "問題標題",
        traceability: lineRangeTraceability(14, 18),
        context: "具體情境",
        deviation: "預期與實際有落差",
        impact: "會造成 correctness 問題",
        suggestion: "補上 guard",
        confidence: 88
      }
    ]
  });
});

test("StructuredOutputValidator rejects malformed JSON and extra non-JSON text", () => {
  const validator = new StructuredOutputValidator();

  assert.throws(
    () =>
      validator.validate({
        validatorId: "findings-json",
        responseText: "{\"findings\":[}"
      }),
    /deterministic validation failed/u
  );

  assert.throws(
    () =>
      validator.validate({
        validatorId: "findings-json",
        responseText:
          "{\"findings\": []}\nextra trailing text"
      }),
    /deterministic validation failed/u
  );
});

test("StructuredOutputValidator rejects schema-invalid findings payloads", () => {
  const validator = new StructuredOutputValidator();

  assert.throws(
    () =>
      validator.validate({
        validatorId: "findings-json",
        responseText: JSON.stringify({
          findings: [
            {
              type: "must",
              title: "",
              traceability: lineRangeTraceability(14, 18),
              context: "具體情境",
              deviation: "預期與實際有落差",
              impact: "會造成 correctness 問題",
              suggestion: "補上 guard",
              confidence: 88
            }
          ]
        })
      }),
    /deterministic validation failed/u
  );

  assert.throws(
    () =>
      validator.validate({
        validatorId: "findings-json",
        responseText: JSON.stringify({
          findings: [
            {
              type: "must",
              title: "問題標題",
              traceability: lineRangeTraceability(14, 18),
              context: "具體情境",
              deviation: "預期與實際有落差",
              impact: "會造成 correctness 問題",
              suggestion: "補上 guard"
            }
          ]
        })
      }),
    /deterministic validation failed/u
  );
});

test("StructuredOutputValidator filters findings by default confidence thresholds", () => {
  const validator = new StructuredOutputValidator();

  const result = validator.validate({
    validatorId: "findings-json",
    responseText: JSON.stringify({
      findings: [
        {
          type: "must",
          title: "保留 must",
          traceability: lineRangeTraceability(10, 12),
          context: "具體情境",
          deviation: "預期與實際有落差",
          impact: "影響 correctness",
          suggestion: "補上 guard",
          confidence: 80
        },
        {
          type: "must",
          title: "移除 must",
          traceability: lineRangeTraceability(15, 15),
          context: "具體情境",
          deviation: "預期與實際有落差",
          impact: "影響 correctness",
          suggestion: "補上 guard",
          confidence: 79
        },
        {
          type: "nice",
          title: "保留 nice",
          traceability: diffHunkTraceability("@@ -20,2 +20,4 @@"),
          context: "具體情境",
          deviation: "可再調整",
          impact: "影響可維護性",
          suggestion: "補上整理",
          confidence: 90
        },
        {
          type: "nice",
          title: "移除 nice",
          traceability: lineRangeTraceability(30, 31),
          context: "具體情境",
          deviation: "可再調整",
          impact: "影響可維護性",
          suggestion: "補上整理",
          confidence: 89
        }
      ]
    }),
    diffContent: [
      "@@ -20,2 +20,4 @@",
      "-old()",
      "+new()"
    ].join("\n")
  });

  assert.deepEqual(result, {
    findings: [
      {
        type: "must",
        title: "保留 must",
        traceability: lineRangeTraceability(10, 12),
        context: "具體情境",
        deviation: "預期與實際有落差",
        impact: "影響 correctness",
        suggestion: "補上 guard",
        confidence: 80
      },
      {
        type: "nice",
        title: "保留 nice",
        traceability: diffHunkTraceability("@@ -20,2 +20,4 @@"),
        context: "具體情境",
        deviation: "可再調整",
        impact: "影響可維護性",
        suggestion: "補上整理",
        confidence: 90
      }
    ]
  });
});

test("StructuredOutputValidator filters findings by supplied confidence thresholds", () => {
  const validator = new StructuredOutputValidator({
    confidenceThresholds: {
      must: 70,
      nice: 85
    }
  });

  const result = validator.validate({
    validatorId: "findings-json",
    responseText: JSON.stringify({
      findings: [
        {
          type: "must",
          title: "保留 must",
          traceability: lineRangeTraceability(3, 3),
          context: "具體情境",
          deviation: "預期與實際有落差",
          impact: "影響 correctness",
          suggestion: "補上 guard",
          confidence: 70
        },
        {
          type: "must",
          title: "移除 must",
          traceability: lineRangeTraceability(4, 5),
          context: "具體情境",
          deviation: "預期與實際有落差",
          impact: "影響 correctness",
          suggestion: "補上 guard",
          confidence: 69
        },
        {
          type: "nice",
          title: "保留 nice",
          traceability: lineRangeTraceability(8, 10),
          context: "具體情境",
          deviation: "可再調整",
          impact: "影響可維護性",
          suggestion: "補上整理",
          confidence: 85
        },
        {
          type: "nice",
          title: "移除 nice",
          traceability: diffHunkTraceability("@@ -30,1 +30,2 @@"),
          context: "具體情境",
          deviation: "可再調整",
          impact: "影響可維護性",
          suggestion: "補上整理",
          confidence: 84
        }
      ]
    }),
    diffContent: "@@ -30,1 +30,2 @@\n-old\n+new\n"
  });

  assert.deepEqual(result, {
    findings: [
      {
        type: "must",
        title: "保留 must",
        traceability: lineRangeTraceability(3, 3),
        context: "具體情境",
        deviation: "預期與實際有落差",
        impact: "影響 correctness",
        suggestion: "補上 guard",
        confidence: 70
      },
      {
        type: "nice",
        title: "保留 nice",
        traceability: lineRangeTraceability(8, 10),
        context: "具體情境",
        deviation: "可再調整",
        impact: "影響可維護性",
        suggestion: "補上整理",
        confidence: 85
      }
    ]
  });
});

test("StructuredOutputValidator accepts an empty findings array", () => {
  const validator = new StructuredOutputValidator();

  const result = validator.validate({
    validatorId: "findings-json",
    responseText: JSON.stringify({ findings: [] })
  });

  assert.deepEqual(result, { findings: [] });
});

test("StructuredOutputValidator rejects findings without traceability", () => {
  const validator = new StructuredOutputValidator();

  assert.throws(
    () =>
      validator.validate({
        validatorId: "findings-json",
        responseText: JSON.stringify({
          findings: [
            {
              type: "must",
              title: "缺少 traceability",
              context: "具體情境",
              deviation: "預期與實際有落差",
              impact: "會造成 correctness 問題",
              suggestion: "補上 guard",
              confidence: 88
            }
          ]
        })
      }),
    /deterministic validation failed/u
  );
});

test("StructuredOutputValidator rejects unsupported traceability kinds", () => {
  const validator = new StructuredOutputValidator();

  assert.throws(
    () =>
      validator.validate({
        validatorId: "findings-json",
        responseText: JSON.stringify({
          findings: [
            {
              type: "must",
              title: "不支援 kind",
              traceability: {
                kind: "file-offset",
                offsetStart: 1,
                offsetEnd: 2
              },
              context: "具體情境",
              deviation: "預期與實際有落差",
              impact: "會造成 correctness 問題",
              suggestion: "補上 guard",
              confidence: 88
            }
          ]
        })
      }),
    /deterministic validation failed/u
  );
});

test("StructuredOutputValidator rejects line-range traceability with inverted bounds", () => {
  const validator = new StructuredOutputValidator();

  assert.throws(
    () =>
      validator.validate({
        validatorId: "findings-json",
        responseText: JSON.stringify({
          findings: [
            {
              type: "must",
              title: "行號倒置",
              traceability: lineRangeTraceability(20, 19),
              context: "具體情境",
              deviation: "預期與實際有落差",
              impact: "會造成 correctness 問題",
              suggestion: "補上 guard",
              confidence: 88
            }
          ]
        })
      }),
    /deterministic validation failed/u
  );
});

test("StructuredOutputValidator rejects diff-hunk traceability when the header is unknown", () => {
  const validator = new StructuredOutputValidator();

  assert.throws(
    () =>
      validator.validate({
        validatorId: "findings-json",
        responseText: JSON.stringify({
          findings: [
            {
              type: "must",
              title: "未知 hunk",
              traceability: diffHunkTraceability("@@ -40,2 +40,3 @@"),
              context: "具體情境",
              deviation: "預期與實際有落差",
              impact: "會造成 correctness 問題",
              suggestion: "補上 guard",
              confidence: 88
            }
          ]
        }),
        diffContent: "@@ -1 +1 @@\n-old\n+new\n"
      }),
    /deterministic validation failed/u
  );
});

test("StructuredOutputValidator rejects diff-hunk traceability when the diff has no hunk headers", () => {
  const validator = new StructuredOutputValidator();

  assert.throws(
    () =>
      validator.validate({
        validatorId: "findings-json",
        responseText: JSON.stringify({
          findings: [
            {
              type: "must",
              title: "無 hunk diff",
              traceability: diffHunkTraceability("@@ -1 +1 @@"),
              context: "具體情境",
              deviation: "預期與實際有落差",
              impact: "會造成 correctness 問題",
              suggestion: "補上 guard",
              confidence: 88
            }
          ]
        }),
        diffContent: "diff --git a/src/app.ts b/src/app.ts\nindex 123..456 100644\n"
      }),
    /deterministic validation failed/u
  );
});

function lineRangeTraceability(lineStart: number, lineEnd: number) {
  return {
    kind: "line-range",
    lineStart,
    lineEnd
  };
}

function diffHunkTraceability(hunkHeader: string) {
  return {
    kind: "diff-hunk",
    hunkHeader
  };
}
