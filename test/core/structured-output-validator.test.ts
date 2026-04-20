import assert from "node:assert/strict";
import test from "node:test";

import { StructuredOutputValidator } from "../../src/core/structured-output-validator.ts";

const DEFAULT_HUNK_HEADER = "@@ -20,2 +20,4 @@";
const DEFAULT_DIFF = [
  DEFAULT_HUNK_HEADER,
  " context-before",
  "+added-21",
  "+added-22",
  " context-after"
].join("\n");

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
    expectedBehavior: "應保留原本的 null guard 行為",
    actualBehavior: "改動後會在檢查前 dereference input",
    deviation: "預期與實際有落差",
    impact: "會造成 correctness 問題",
    suggestion: "補上 guard",
    modelConfidence: 88,
    findingId: "F1",
    supportingEvidence: [
      { evidenceRef: "E1", supports: "expectedBehavior" },
      { evidenceRef: "E2", supports: "actualBehavior" },
      { evidenceRef: "E3", supports: "reachability" },
      { evidenceRef: "E4", supports: "impact" }
    ],
    reachability: {
      credible: true,
      entryPoint: "handleRequest",
      guardsChecked: ["input is passed from the public API"]
    },
    uncertaintyStatus: "supported",
    ...overrides
  };
}

function payload(findings: unknown[]): string {
  return JSON.stringify({ schemaVersion: 2, findings });
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

  return validator.filterByAcceptance(payload);
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

test("StructuredOutputValidator migrates legacy confidence to canonical modelConfidence", () => {
  const legacyFinding = finding({
    modelConfidence: undefined,
    confidence: 77
  });
  const { confidence: _legacy, ...expectedFindingWithoutLegacy } = legacyFinding;
  const expectedFinding = {
    ...expectedFindingWithoutLegacy,
    modelConfidence: 77
  };

  assert.deepEqual(validate({ responseText: payload([legacyFinding]) }), {
    schemaVersion: 2,
    findings: [expectedFinding]
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
    },
    {
      label: "missing modelConfidence",
      invalidFinding: finding({ modelConfidence: undefined })
    },
    {
      label: "modelConfidence above 100",
      invalidFinding: finding({ modelConfidence: 101 })
    },
    {
      label: "string modelConfidence",
      invalidFinding: finding({ modelConfidence: "88" })
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
    title: "must above threshold",
    traceability: lineRangeTraceability(10, 12),
    modelConfidence: 80
  });
  const mustBelow = finding({
    findingId: "F2",
    type: "must",
    title: "must below threshold",
    traceability: lineRangeTraceability(15, 15),
    modelConfidence: 50
  });

  assert.deepEqual(
    validate({
      responseText: payload([mustAbove, mustBelow])
    }),
    { schemaVersion: 2, findings: [mustAbove, mustBelow] }
  );
});

test("StructuredOutputValidator filterByAcceptance keeps supported credible findings regardless of modelConfidence", () => {
  const keptMust = finding({
    findingId: "F1",
    type: "must",
    title: "保留 must",
    traceability: lineRangeTraceability(20, 22),
    impact: "影響 correctness",
    modelConfidence: 5
  });
  const keptNice = finding({
    findingId: "F2",
    type: "nice",
    title: "保留 nice",
    traceability: diffHunkTraceability(DEFAULT_HUNK_HEADER),
    deviation: "可再調整",
    impact: "影響可維護性",
    suggestion: "補上整理",
    modelConfidence: 10
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
          modelConfidence: 99,
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
          modelConfidence: 99,
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

test("StructuredOutputValidator filterByAcceptance ignores supplied confidence thresholds once deterministic gates pass", () => {
  const keptMust = finding({
    findingId: "F1",
    type: "must",
    title: "保留 must",
    traceability: lineRangeTraceability(30, 30),
    impact: "影響 correctness",
    modelConfidence: 1
  });
  const keptNice = finding({
    findingId: "F2",
    type: "nice",
    title: "保留 nice",
    traceability: lineRangeTraceability(30, 31),
    deviation: "可再調整",
    impact: "影響可維護性",
    suggestion: "補上整理",
    modelConfidence: 2
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
          modelConfidence: 99,
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
          modelConfidence: 99,
          reachability: {
            credible: false,
            entryPoint: "handleRequest",
            guardsChecked: ["guard checked"]
          }
        })
      ]),
      diffContent: `${customHunkHeader}\n-old\n+new\n`,
      thresholds: { must: 70, nice: 85 }
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

test("StructuredOutputValidator rejects line-range outside changed head lines with ANCHOR tag", () => {
  const offsetFinding = finding({
    traceability: lineRangeTraceability(14, 18)
  });

  assert.throws(
    () =>
      new StructuredOutputValidator().validate({
        responseText: payload([offsetFinding]),
        diffContent: DEFAULT_DIFF,
        filePath: "src/foo.ts"
      }),
    /deterministic validation failed: 'traceability' \[ANCHOR\] line range 14-18/u
  );
});

test("StructuredOutputValidator rejects line-range inside hunk span when it misses all changed lines", () => {
  const unchangedSpanFinding = finding({
    traceability: lineRangeTraceability(23, 23)
  });

  assert.throws(
    () =>
      new StructuredOutputValidator().validate({
        responseText: payload([unchangedSpanFinding]),
        diffContent: DEFAULT_DIFF,
        filePath: "src/foo.ts"
      }),
    /deterministic validation failed: 'traceability' \[ANCHOR\] line range 23-23/u
  );
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

test("StructuredOutputValidator rejects unknown diff-hunk header with ANCHOR tag when diffContent is supplied", () => {
  const unknownHunkFinding = finding({
    traceability: diffHunkTraceability("@@ -40,2 +40,3 @@")
  });

  assert.throws(
    () =>
      new StructuredOutputValidator().validate({
        responseText: payload([unknownHunkFinding]),
        diffContent: DEFAULT_DIFF,
        filePath: "src/foo.ts"
      }),
    /deterministic validation failed: 'traceability' \[ANCHOR\] hunk header '@@ -40,2 \+40,3 @@'/u
  );
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

test("StructuredOutputValidator filterByAcceptance filters tentative findings regardless of confidence", () => {
  const tentative = finding({
    findingId: "F-tent",
    uncertaintyStatus: "tentative",
    modelConfidence: 99
  });
  const supported = finding({
    findingId: "F-supp",
    uncertaintyStatus: "supported",
    modelConfidence: 1
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
    modelConfidence: 95
  });
  const reachable = finding({
    findingId: "F-reach",
    reachability: {
      credible: true,
      entryPoint: "handleRequest",
      guardsChecked: ["guard checked"]
    },
    uncertaintyStatus: "supported",
    modelConfidence: 0
  });

  assert.deepEqual(
    validateAndFilter({
      responseText: payload([unreachable, reachable])
    }),
    { schemaVersion: 2, findings: [reachable] }
  );
});

// --- validateWithDispositions tests ---

function disposition(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    findingId: "F1",
    status: "retained",
    reason: "SUPPORTED",
    explanation: "simulation confirmed the finding",
    ...overrides
  };
}

function acceptedVerifierVerdict(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    status: "accepted",
    checks: {
      anchor: "pass",
      evidence: "pass",
      reachability: "pass",
      impact: "pass",
      scope: "pass",
      duplicate: "pass"
    },
    ...overrides
  };
}

function verifiedFinding(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return finding({
    verifierVerdict: acceptedVerifierVerdict(),
    ...overrides
  });
}

function verifiedPayload(findings: unknown[], dispositions: unknown[]): string {
  return JSON.stringify({ schemaVersion: 2, findings, dispositions });
}

function validateWithDispositions(input: {
  responseText: string;
  diffContent?: string;
}) {
  return new StructuredOutputValidator().validateWithDispositions({
    responseText: input.responseText,
    ...(input.diffContent === undefined ? {} : { diffContent: input.diffContent })
  });
}

function assertDispositionValidationFails(input: {
  responseText: string;
  diffContent?: string;
  label?: string;
}): void {
  assert.throws(
    () =>
      new StructuredOutputValidator().validateWithDispositions({
        responseText: input.responseText,
        ...(input.diffContent === undefined ? {} : { diffContent: input.diffContent })
      }),
    /deterministic validation failed/u,
    input.label
  );
}

test("validateWithDispositions accepts valid findings and dispositions", () => {
  const f = verifiedFinding();
  const d = disposition();
  const result = validateWithDispositions({
    responseText: verifiedPayload([f], [d])
  });

  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0]!.findingId, "F1");
  assert.equal(result.dispositions.length, 1);
  assert.equal(result.dispositions[0]!.findingId, "F1");
  assert.equal(result.dispositions[0]!.status, "retained");
});

test("validateWithDispositions accepts VerifiedFindingSet schemaVersion 2", () => {
  const result = validateWithDispositions({
    responseText: JSON.stringify({
      schemaVersion: 2,
      findings: [verifiedFinding()],
      dispositions: [disposition()]
    })
  });

  assert.equal(result.schemaVersion, 2);
});

test("validateWithDispositions accepts empty findings and dispositions", () => {
  const result = validateWithDispositions({
    responseText: verifiedPayload([], [])
  });

  assert.deepEqual(result, { schemaVersion: 2, findings: [], dispositions: [] });
});

test("validateWithDispositions rejects missing dispositions key", () => {
  assertDispositionValidationFails({
    label: "missing dispositions",
    responseText: payload([finding()])
  });
});

test("validateWithDispositions rejects missing findings key", () => {
  assertDispositionValidationFails({
    label: "missing findings",
    responseText: JSON.stringify({ dispositions: [disposition()] })
  });
});

test("validateWithDispositions rejects unknown top-level field", () => {
  assert.throws(
    () =>
      new StructuredOutputValidator().validateWithDispositions({
        responseText: JSON.stringify({
          findings: [verifiedFinding()],
          dispositions: [disposition()],
          metadata: {}
        })
      }),
    /unknown field/u
  );
});

test("validateWithDispositions rejects unsupported VerifiedFindingSet schemaVersion", () => {
  assertDispositionValidationFails({
    responseText: JSON.stringify({
      schemaVersion: 1,
      findings: [],
      dispositions: []
    })
  });
});

test("validateWithDispositions rejects non-array dispositions", () => {
  assertDispositionValidationFails({
    label: "dispositions is object",
    responseText: JSON.stringify({ schemaVersion: 2, findings: [], dispositions: {} })
  });
});

test("validateWithDispositions rejects disposition missing findingId", () => {
  assertDispositionValidationFails({
    label: "missing findingId",
    responseText: verifiedPayload([], [
      { status: "retained", reason: "R", explanation: "E" }
    ])
  });
});

test("validateWithDispositions rejects disposition missing status", () => {
  assertDispositionValidationFails({
    label: "missing status",
    responseText: verifiedPayload([], [
      { findingId: "F1", reason: "R", explanation: "E" }
    ])
  });
});

test("validateWithDispositions rejects disposition missing reason", () => {
  assertDispositionValidationFails({
    label: "missing reason",
    responseText: verifiedPayload([], [
      { findingId: "F1", status: "retained", explanation: "E" }
    ])
  });
});

test("validateWithDispositions rejects disposition missing explanation", () => {
  assertDispositionValidationFails({
    label: "missing explanation",
    responseText: verifiedPayload([], [
      { findingId: "F1", status: "retained", reason: "R" }
    ])
  });
});

test("validateWithDispositions rejects invalid disposition status", () => {
  assert.throws(
    () =>
      new StructuredOutputValidator().validateWithDispositions({
        responseText: verifiedPayload([], [
          disposition({ status: "promoted" })
        ])
      }),
    /retained.*modified.*retired/u
  );
});

test("validateWithDispositions rejects unknown field in disposition", () => {
  assert.throws(
    () =>
      new StructuredOutputValidator().validateWithDispositions({
        responseText: verifiedPayload([], [
          disposition({ extraField: "bad" })
        ])
      }),
    /unknown field/u
  );
});

test("validateWithDispositions rejects duplicate findingId in dispositions", () => {
  assert.throws(
    () =>
      new StructuredOutputValidator().validateWithDispositions({
        responseText: verifiedPayload([], [
          disposition({ findingId: "F1" }),
          disposition({ findingId: "F1" })
        ])
      }),
    /duplicate/u
  );
});

test("validateWithDispositions rejects duplicate findingId in findings", () => {
  assert.throws(
    () =>
      new StructuredOutputValidator().validateWithDispositions({
        responseText: verifiedPayload(
          [verifiedFinding({ findingId: "F1" }), verifiedFinding({ findingId: "F1" })],
          [disposition()]
        )
      }),
    /duplicate/u
  );
});

test("validateWithDispositions validates each disposition status value", () => {
  for (const status of ["retained", "modified", "retired"]) {
    const result = validateWithDispositions({
      responseText: verifiedPayload([], [disposition({ status })])
    });
    assert.equal(result.dispositions[0]!.status, status);
  }
});

test("validateWithDispositions validates each disposition reason value", () => {
  for (const reason of [
    "SUPPORTED",
    "ANCHOR",
    "EVIDENCE",
    "REACHABILITY",
    "OUT_OF_SCOPE",
    "DUPLICATE",
    "CONTRADICTION"
  ]) {
    const result = validateWithDispositions({
      responseText: verifiedPayload([], [disposition({ reason })])
    });
    assert.equal(result.dispositions[0]!.reason, reason);
  }
});

test("validateWithDispositions rejects invalid disposition reason", () => {
  assert.throws(
    () =>
      new StructuredOutputValidator().validateWithDispositions({
        responseText: verifiedPayload([], [
          disposition({ reason: "STALE_CONTEXT" })
        ])
      }),
    /SUPPORTED.*ANCHOR.*EVIDENCE.*REACHABILITY.*OUT_OF_SCOPE.*DUPLICATE.*CONTRADICTION/u
  );
});

test("validateWithDispositions rejects finding missing verifierVerdict", () => {
  assertDispositionValidationFails({
    responseText: verifiedPayload([finding()], [disposition()])
  });
});

test("validateWithDispositions rejects non-accepted verifierVerdict", () => {
  assert.throws(
    () =>
      new StructuredOutputValidator().validateWithDispositions({
        responseText: verifiedPayload(
          [verifiedFinding({ verifierVerdict: acceptedVerifierVerdict({ status: "rejected" }) })],
          [disposition()]
        )
      }),
    /verifierVerdict\.status.*accepted/u
  );
});

test("validateWithDispositions rejects verifierVerdict checks that do not pass", () => {
  assert.throws(
    () =>
      new StructuredOutputValidator().validateWithDispositions({
        responseText: verifiedPayload(
          [
            verifiedFinding({
              verifierVerdict: acceptedVerifierVerdict({
                checks: {
                  anchor: "pass",
                  evidence: "pass",
                  reachability: "fail",
                  impact: "pass",
                  scope: "pass",
                  duplicate: "pass"
                }
              })
            })
          ],
          [disposition()]
        )
      }),
    /verifierVerdict\.checks\.reachability.*pass/u
  );
});

test("validateWithDispositions rejects accepted findings that fail Step 6 acceptance gates", () => {
  assert.throws(
    () =>
      new StructuredOutputValidator().validateWithDispositions({
        responseText: verifiedPayload(
          [
            verifiedFinding({
              uncertaintyStatus: "tentative"
            })
          ],
          [disposition()]
        )
      }),
    /must be accepted.*uncertaintyStatus/u
  );
});

// --- validateDispositionCompleteness tests ---

test("validateDispositionCompleteness passes when all candidates accounted for", () => {
  const validator = new StructuredOutputValidator();
  validator.validateDispositionCompleteness({
    dispositions: [
      { findingId: "F1", status: "retained", reason: "SUPPORTED", explanation: "ok" },
      { findingId: "F2", status: "retired", reason: "REACHABILITY", explanation: "not reachable" }
    ],
    candidateFindingIds: ["F1", "F2"],
    acceptedFindingIds: ["F1"]
  });
});

test("validateDispositionCompleteness throws when candidate is missing from dispositions", () => {
  const validator = new StructuredOutputValidator();
  assert.throws(
    () =>
      validator.validateDispositionCompleteness({
        dispositions: [
          { findingId: "F1", status: "retained", reason: "SUPPORTED", explanation: "ok" }
        ],
        candidateFindingIds: ["F1", "F2"],
        acceptedFindingIds: ["F1"]
      }),
    /missing disposition.*F2/u
  );
});

test("validateDispositionCompleteness throws when disposition references unknown candidate", () => {
  const validator = new StructuredOutputValidator();
  assert.throws(
    () =>
      validator.validateDispositionCompleteness({
        dispositions: [
          { findingId: "F99", status: "retired", reason: "ANCHOR", explanation: "bogus" }
        ],
        candidateFindingIds: [],
        acceptedFindingIds: []
      }),
    /unknown candidate.*F99/u
  );
});

test("validateDispositionCompleteness throws when retained candidate missing from findings", () => {
  const validator = new StructuredOutputValidator();
  assert.throws(
    () =>
      validator.validateDispositionCompleteness({
        dispositions: [
          { findingId: "F1", status: "retained", reason: "SUPPORTED", explanation: "ok" }
        ],
        candidateFindingIds: ["F1"],
        acceptedFindingIds: []
      }),
    /retained.*F1.*must appear in findings/u
  );
});

test("validateDispositionCompleteness throws when modified candidate missing from findings", () => {
  const validator = new StructuredOutputValidator();
  assert.throws(
    () =>
      validator.validateDispositionCompleteness({
        dispositions: [
          { findingId: "F1", status: "modified", reason: "EVIDENCE", explanation: "updated" }
        ],
        candidateFindingIds: ["F1"],
        acceptedFindingIds: []
      }),
    /modified.*F1.*must appear in findings/u
  );
});

test("validateDispositionCompleteness passes when retired candidate absent from findings", () => {
  const validator = new StructuredOutputValidator();
  validator.validateDispositionCompleteness({
    dispositions: [
      { findingId: "F1", status: "retired", reason: "REACHABILITY", explanation: "gone" }
    ],
    candidateFindingIds: ["F1"],
    acceptedFindingIds: []
  });
});

test("validateDispositionCompleteness throws when retired candidate appears in findings", () => {
  const validator = new StructuredOutputValidator();
  assert.throws(
    () =>
      validator.validateDispositionCompleteness({
        dispositions: [
          { findingId: "F1", status: "retired", reason: "REACHABILITY", explanation: "gone" }
        ],
        candidateFindingIds: ["F1"],
        acceptedFindingIds: ["F1"]
      }),
    /retired.*F1.*must not appear in findings/u
  );
});

test("validateDispositionCompleteness allows new findings without disposition entry", () => {
  const validator = new StructuredOutputValidator();
  validator.validateDispositionCompleteness({
    dispositions: [
      { findingId: "F1", status: "retained", reason: "SUPPORTED", explanation: "ok" }
    ],
    candidateFindingIds: ["F1"],
    acceptedFindingIds: ["F1", "F3"]
  });
});

// --- validateWithReport ---

test("validateWithReport returns payload and per-finding schema-pass report entries", () => {
  const validator = new StructuredOutputValidator();
  const f = finding({ traceability: lineRangeTraceability(21, 22) });
  const result = validator.validateWithReport({
    responseText: payload([f]),
    diffContent: DEFAULT_DIFF,
    filePath: "src/app.ts"
  });

  assert.equal(result.payload.findings.length, 1);
  assert.equal(result.report.length, 1);
  assert.equal(result.report[0].findingId, "F1");
  assert.equal(result.report[0].taxonomy, "OK");
  assert.equal(result.report[0].outcome, "accepted");
  assert.equal(result.report[0].gate, "schema");
});

test("validateWithReport with multiple findings returns per-finding entries", () => {
  const validator = new StructuredOutputValidator();
  const f1 = finding({ findingId: "F1", traceability: lineRangeTraceability(21, 22) });
  const f2 = finding({ findingId: "F2", traceability: lineRangeTraceability(21, 22), type: "nice", modelConfidence: 75 });
  const result = validator.validateWithReport({
    responseText: payload([f1, f2]),
    diffContent: DEFAULT_DIFF,
    filePath: "src/app.ts"
  });

  assert.equal(result.payload.findings.length, 2);
  assert.equal(result.report.length, 2);
  assert.equal(result.report[0].findingId, "F1");
  assert.equal(result.report[1].findingId, "F2");
});

test("validateWithReport throws on schema error (same as validate)", () => {
  const validator = new StructuredOutputValidator();
  assert.throws(
    () => validator.validateWithReport({ responseText: "not json" }),
    /deterministic validation failed/u
  );
});

// --- filterByAcceptanceWithReport ---

test("filterByAcceptanceWithReport accepts supported credible finding with OK taxonomy", () => {
  const validator = new StructuredOutputValidator();
  const f = finding({ traceability: lineRangeTraceability(21, 22) });
  const validated = validator.validate({
    responseText: payload([f]),
    diffContent: DEFAULT_DIFF,
    filePath: "src/app.ts"
  });

  const result = validator.filterByAcceptanceWithReport(validated);
  assert.equal(result.payload.findings.length, 1);
  assert.equal(result.report.length, 1);
  assert.equal(result.report[0].findingId, "F1");
  assert.equal(result.report[0].taxonomy, "OK");
  assert.equal(result.report[0].outcome, "accepted");
  assert.equal(result.report[0].gate, "acceptance");
});

test("filterByAcceptanceWithReport rejects tentative finding with EVIDENCE taxonomy", () => {
  const validator = new StructuredOutputValidator();
  const f = finding({ traceability: lineRangeTraceability(21, 22), uncertaintyStatus: "tentative" });
  const validated = validator.validate({
    responseText: payload([f]),
    diffContent: DEFAULT_DIFF,
    filePath: "src/app.ts"
  });

  const result = validator.filterByAcceptanceWithReport(validated);
  assert.equal(result.payload.findings.length, 0);
  assert.equal(result.report.length, 1);
  assert.equal(result.report[0].taxonomy, "EVIDENCE");
  assert.equal(result.report[0].outcome, "rejected");
  assert.equal(result.report[0].gate, "acceptance");
});

test("filterByAcceptanceWithReport rejects non-credible reachability with REACHABILITY taxonomy", () => {
  const validator = new StructuredOutputValidator();
  const f = finding({
    traceability: lineRangeTraceability(21, 22),
    reachability: {
      credible: false,
      entryPoint: "handleRequest",
      guardsChecked: ["guard checked"]
    }
  });
  const validated = validator.validate({
    responseText: payload([f]),
    diffContent: DEFAULT_DIFF,
    filePath: "src/app.ts"
  });

  const result = validator.filterByAcceptanceWithReport(validated);
  assert.equal(result.payload.findings.length, 0);
  assert.equal(result.report.length, 1);
  assert.equal(result.report[0].taxonomy, "REACHABILITY");
  assert.equal(result.report[0].outcome, "rejected");
});

test("filterByAcceptanceWithReport accepts low modelConfidence finding once deterministic gates pass", () => {
  const validator = new StructuredOutputValidator({ confidenceThresholds: { must: 80, nice: 90 } });
  const f = finding({ traceability: lineRangeTraceability(21, 22), modelConfidence: 0 });
  const validated = validator.validate({
    responseText: payload([f]),
    diffContent: DEFAULT_DIFF,
    filePath: "src/app.ts"
  });

  const result = validator.filterByAcceptanceWithReport(validated);
  assert.equal(result.payload.findings.length, 1);
  assert.equal(result.report.length, 1);
  assert.equal(result.report[0].taxonomy, "OK");
  assert.equal(result.report[0].outcome, "accepted");
});

test("filterByAcceptanceWithReport with mixed accepted and rejected findings", () => {
  const validator = new StructuredOutputValidator();
  const accepted = finding({ findingId: "F1", traceability: lineRangeTraceability(21, 22) });
  const rejectedUncertainty = finding({ findingId: "F2", traceability: lineRangeTraceability(21, 22), uncertaintyStatus: "unsupported" });
  const validated = validator.validate({
    responseText: payload([accepted, rejectedUncertainty]),
    diffContent: DEFAULT_DIFF,
    filePath: "src/app.ts"
  });

  const result = validator.filterByAcceptanceWithReport(validated);
  assert.equal(result.payload.findings.length, 1);
  assert.equal(result.payload.findings[0].findingId, "F1");
  assert.equal(result.report.length, 2);

  const okEntry = result.report.find(e => e.findingId === "F1");
  assert.equal(okEntry?.taxonomy, "OK");
  assert.equal(okEntry?.outcome, "accepted");

  const rejEntry = result.report.find(e => e.findingId === "F2");
  assert.equal(rejEntry?.taxonomy, "EVIDENCE");
  assert.equal(rejEntry?.outcome, "rejected");
});
