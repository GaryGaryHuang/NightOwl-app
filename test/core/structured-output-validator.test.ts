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

test("StructuredOutputValidator filterByAcceptance keeps supported credible findings", () => {
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
      responseText: payload([
        keptMust,
        finding({
          findingId: "F3",
          type: "must",
          title: "移除 must",
          traceability: lineRangeTraceability(20, 21),
          impact: "影響 correctness",
          uncertaintyStatus: "tentative"
        }),
        keptNice,
        finding({
          findingId: "F4",
          type: "nice",
          title: "移除 nice",
          traceability: lineRangeTraceability(21, 21),
          deviation: "可再調整",
          impact: "影響可維護性",
          suggestion: "補上整理",
          reachability: {
            credible: false,
            entryPoint: "handleRequest",
            guardsChecked: ["guard checked"]
          }
        })
      ]),
      diffContent: DEFAULT_DIFF
    }),
    { schemaVersion: 2, findings: [keptMust, keptNice] }
  );
});

test("StructuredOutputValidator filterByAcceptance keeps findings once deterministic gates pass", () => {
  const keptMust = finding({
    findingId: "F1",
    type: "must",
    title: "保留 must",
    traceability: lineRangeTraceability(30, 30),
    impact: "影響 correctness",
  });
  const keptNice = finding({
    findingId: "F2",
    type: "nice",
    title: "保留 nice",
    traceability: lineRangeTraceability(30, 31),
    deviation: "可再調整",
    impact: "影響可維護性",
    suggestion: "補上整理",
  });
  const customHunkHeader = "@@ -30,1 +30,2 @@";

  assert.deepEqual(
    validateAndFilter({
      responseText: payload([
        keptMust,
        finding({
          findingId: "F3",
          type: "must",
          title: "移除 must",
          traceability: lineRangeTraceability(30, 30),
          impact: "影響 correctness",
          uncertaintyStatus: "unsupported"
        }),
        keptNice,
        finding({
          findingId: "F4",
          type: "nice",
          title: "移除 nice",
          traceability: diffHunkTraceability(customHunkHeader),
          deviation: "可再調整",
          impact: "影響可維護性",
          suggestion: "補上整理",
          reachability: {
            credible: false,
            entryPoint: "handleRequest",
            guardsChecked: ["guard checked"]
          }
        })
      ]),
      diffContent: `${customHunkHeader}\n-old\n+new\n`
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

test("StructuredOutputValidator rejects empty supportingEvidence array", () => {
  assertValidationFails({
    responseText: payload([finding({ supportingEvidence: [] })])
  });
});

test("StructuredOutputValidator rejects supportingEvidence that is not an array", () => {
  assertValidationFails({
    responseText: payload([finding({ supportingEvidence: "not-array" })])
  });
});

test("StructuredOutputValidator rejects evidence ref with empty evidenceRef", () => {
  assertValidationFails({
    responseText: payload([
      finding({
        supportingEvidence: [
          { evidenceRef: "", supports: "expectedBehavior" },
          { evidenceRef: "E2", supports: "actualBehavior" },
          { evidenceRef: "E3", supports: "reachability" },
          { evidenceRef: "E4", supports: "impact" }
        ]
      })
    ])
  });
});

test("StructuredOutputValidator rejects evidence ref with invalid supports role", () => {
  assertValidationFails({
    responseText: payload([
      finding({
        supportingEvidence: [
          { evidenceRef: "E1", supports: "expectedBehavior" },
          { evidenceRef: "E2", supports: "actualBehavior" },
          { evidenceRef: "E3", supports: "reachability" },
          { evidenceRef: "E4", supports: "security" }
        ]
      })
    ])
  });
});

test("StructuredOutputValidator rejects evidence ref with unknown fields", () => {
  assertValidationFails({
    responseText: payload([
      finding({
        supportingEvidence: [
          { evidenceRef: "E1", supports: "expectedBehavior", url: "http://x" },
          { evidenceRef: "E2", supports: "actualBehavior" },
          { evidenceRef: "E3", supports: "reachability" },
          { evidenceRef: "E4", supports: "impact" }
        ]
      })
    ])
  });
});

test("StructuredOutputValidator rejects supportingEvidence missing required role coverage", () => {
  assertValidationFails({
    responseText: payload([
      finding({
        supportingEvidence: [
          { evidenceRef: "E1", supports: "expectedBehavior" },
          { evidenceRef: "E2", supports: "actualBehavior" },
          { evidenceRef: "E3", supports: "reachability" }
        ]
      })
    ])
  });
});

test("StructuredOutputValidator rejects missing reachability", () => {
  assertValidationFails({
    responseText: payload([finding({ reachability: undefined })])
  });
});

test("StructuredOutputValidator rejects reachability with non-boolean credible", () => {
  assertValidationFails({
    responseText: payload([
      finding({
        reachability: {
          credible: "yes",
          entryPoint: "handleRequest",
          guardsChecked: ["guard"]
        }
      })
    ])
  });
});

test("StructuredOutputValidator rejects reachability with empty entryPoint", () => {
  assertValidationFails({
    responseText: payload([
      finding({
        reachability: {
          credible: true,
          entryPoint: "",
          guardsChecked: ["guard"]
        }
      })
    ])
  });
});

test("StructuredOutputValidator rejects reachability with empty guardsChecked", () => {
  assertValidationFails({
    responseText: payload([
      finding({
        reachability: {
          credible: true,
          entryPoint: "handleRequest",
          guardsChecked: []
        }
      })
    ])
  });
});

test("StructuredOutputValidator rejects reachability with blank guard", () => {
  assertValidationFails({
    responseText: payload([
      finding({
        reachability: {
          credible: true,
          entryPoint: "handleRequest",
          guardsChecked: [""]
        }
      })
    ])
  });
});

test("StructuredOutputValidator rejects reachability with unknown fields", () => {
  assertValidationFails({
    responseText: payload([
      finding({
        reachability: {
          credible: true,
          entryPoint: "handleRequest",
          guardsChecked: ["guard"],
          path: "a->b"
        }
      })
    ])
  });
});

test("StructuredOutputValidator rejects invalid uncertaintyStatus value", () => {
  assertValidationFails({
    responseText: payload([finding({ uncertaintyStatus: "maybe" })])
  });
});

test("StructuredOutputValidator rejects missing uncertaintyStatus", () => {
  assertValidationFails({
    responseText: payload([finding({ uncertaintyStatus: undefined })])
  });
});

test("StructuredOutputValidator accepts all valid uncertaintyStatus values", () => {
  for (const status of ["supported", "tentative", "unsupported", "out_of_scope"]) {
    const f = finding({ uncertaintyStatus: status });
    assert.deepEqual(validate({ responseText: payload([f]) }), {
      schemaVersion: 2,
      findings: [f]
    });
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

test("StructuredOutputValidator filterByAcceptance filters tentative findings", () => {
  const tentative = finding({
    findingId: "F-tent",
    uncertaintyStatus: "tentative",
  });
  const supported = finding({
    findingId: "F-supp",
    uncertaintyStatus: "supported",
  });

  assert.deepEqual(
    validateAndFilter({
      responseText: payload([tentative, supported])
    }),
    { schemaVersion: 2, findings: [supported] }
  );
});

test("StructuredOutputValidator filterByAcceptance filters findings with credible=false", () => {
  const unreachable = finding({
    findingId: "F-unreach",
    reachability: {
      credible: false,
      entryPoint: "handleRequest",
      guardsChecked: ["guard checked"]
    },
    uncertaintyStatus: "supported",
  });
  const reachable = finding({
    findingId: "F-reach",
    reachability: {
      credible: true,
      entryPoint: "handleRequest",
      guardsChecked: ["guard checked"]
    },
    uncertaintyStatus: "supported",
  });

  assert.deepEqual(
    validateAndFilter({
      responseText: payload([unreachable, reachable])
    }),
    { schemaVersion: 2, findings: [reachable] }
  );
});
