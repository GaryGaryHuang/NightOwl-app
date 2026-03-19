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
          context: "具體情境",
          deviation: "預期與實際有落差",
          impact: "影響 correctness",
          suggestion: "補上 guard",
          confidence: 80
        },
        {
          type: "must",
          title: "移除 must",
          context: "具體情境",
          deviation: "預期與實際有落差",
          impact: "影響 correctness",
          suggestion: "補上 guard",
          confidence: 79
        },
        {
          type: "nice",
          title: "保留 nice",
          context: "具體情境",
          deviation: "可再調整",
          impact: "影響可維護性",
          suggestion: "補上整理",
          confidence: 90
        },
        {
          type: "nice",
          title: "移除 nice",
          context: "具體情境",
          deviation: "可再調整",
          impact: "影響可維護性",
          suggestion: "補上整理",
          confidence: 89
        }
      ]
    })
  });

  assert.deepEqual(result, {
    findings: [
      {
        type: "must",
        title: "保留 must",
        context: "具體情境",
        deviation: "預期與實際有落差",
        impact: "影響 correctness",
        suggestion: "補上 guard",
        confidence: 80
      },
      {
        type: "nice",
        title: "保留 nice",
        context: "具體情境",
        deviation: "可再調整",
        impact: "影響可維護性",
        suggestion: "補上整理",
        confidence: 90
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
