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
  validate,
  validateAndFilter
} from "../helpers/structured-output-validator-fixture.ts";

test("StructuredOutputValidator accepts schema-valid findings JSON", () => {
  const validFinding = finding();

  assert.deepEqual(validate({ responseText: payload([validFinding]) }), {
    schemaVersion: 2,
    findings: [validFinding]
  });
});

test("StructuredOutputValidator accepts CandidateFindingSet schemaVersion 2", () => {
  const validFinding = finding();

  assert.deepEqual(
    validate({
      responseText: JSON.stringify({ schemaVersion: 2, findings: [validFinding] })
    }),
    {
      schemaVersion: 2,
      findings: [validFinding]
    }
  );
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

test("StructuredOutputValidator rejects unsupported CandidateFindingSet schemaVersion", () => {
  assertValidationFails({
    responseText: JSON.stringify({ schemaVersion: 1, findings: [] })
  });
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
      label: "missing expectedBehavior",
      invalidFinding: finding({ expectedBehavior: undefined })
    },
    {
      label: "empty actualBehavior",
      invalidFinding: finding({ actualBehavior: "" })
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
    findingId: "F1",
    type: "must",
    title: "first must",
    traceability: lineRangeTraceability(10, 12),
  });
  const mustBelow = finding({
    findingId: "F2",
    type: "must",
    title: "second must",
    traceability: lineRangeTraceability(15, 15),
  });

  assert.deepEqual(
    validate({
      responseText: payload([mustAbove, mustBelow])
    }),
    { schemaVersion: 2, findings: [mustAbove, mustBelow] }
  );
});

test("StructuredOutputValidator filterByAcceptance keeps schema-valid findings", () => {
  const keptMust = finding({
    findingId: "F1",
    type: "must",
    title: "保留 must",
    traceability: lineRangeTraceability(20, 22),
    impact: "影響 correctness",
  });
  const keptNice = finding({
    findingId: "F2",
    type: "nice",
    title: "保留 nice",
    traceability: diffHunkTraceability(DEFAULT_HUNK_HEADER),
    deviation: "可再調整",
    impact: "影響可維護性",
    suggestion: "補上整理",
  });

  assert.deepEqual(
    validateAndFilter({
      responseText: payload([keptMust, keptNice]),
      diffContent: DEFAULT_DIFF
    }),
    { schemaVersion: 2, findings: [keptMust, keptNice] }
  );
});

test("StructuredOutputValidator accepts an empty findings array", () => {
  assert.deepEqual(validate({ responseText: payload([]) }), {
    schemaVersion: 2,
    findings: []
  });
});

// --- V2 schema tests ---

test("StructuredOutputValidator rejects missing findingId", () => {
  assertValidationFails({
    responseText: payload([finding({ findingId: undefined })])
  });
});

test("StructuredOutputValidator rejects empty findingId", () => {
  assertValidationFails({
    responseText: payload([finding({ findingId: "" })])
  });
});

test("StructuredOutputValidator rejects duplicate findingId in the same payload", () => {
  assert.throws(
    () =>
      validate({
        responseText: payload([
          finding({ findingId: "F1" }),
          finding({ findingId: "F1", title: "另一個 finding" })
        ])
      }),
    /duplicate findingId 'F1'/u
  );
});

test("StructuredOutputValidator rejects removed internal verifier metadata fields", () => {
  for (const field of [
    "supportingEvidence",
    "reachability",
    "uncertaintyStatus",
    "verifierVerdict"
  ]) {
    assert.throws(
      () =>
        validate({
          responseText: payload([finding({ [field]: "removed" })])
        }),
      new RegExp(field, "u"),
      `${field} should be rejected as an unknown finding field`
    );
  }
});

test("StructuredOutputValidator accepts optional sourceHypothesisId when non-empty", () => {
  const f = finding({ sourceHypothesisId: "W1" });
  assert.deepEqual(validate({ responseText: payload([f]) }), {
    schemaVersion: 2,
    findings: [f]
  });
});

test("StructuredOutputValidator rejects empty sourceHypothesisId", () => {
  assertValidationFails({
    responseText: payload([finding({ sourceHypothesisId: "" })])
  });
});

test("StructuredOutputValidator rejects unknown fields at finding top-level", () => {
  assert.throws(
    () =>
      new StructuredOutputValidator().validate({
        responseText: payload([finding({ extra: true })])
      }),
    /extra/u,
    "error should mention the unknown field name"
  );
});

test("StructuredOutputValidator rejects unknown fields in traceability", () => {
  assert.throws(
    () =>
      new StructuredOutputValidator().validate({
        responseText: payload([
          finding({
            traceability: { kind: "line-range", lineStart: 14, lineEnd: 18, extra: true }
          })
        ])
      }),
    /extra/u,
    "error should mention the unknown field name"
  );
});

test("StructuredOutputValidator rejects unknown fields in top-level payload", () => {
  assert.throws(
    () =>
      new StructuredOutputValidator().validate({
        responseText: JSON.stringify({
          schemaVersion: 2,
          findings: [finding()],
          metadata: {}
        })
      }),
    /metadata/u,
    "error should mention the unknown field name"
  );
});
