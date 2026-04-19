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
    context: "具體情境",
    deviation: "預期與實際有落差",
    impact: "會造成 correctness 問題",
    suggestion: "補上 guard",
    confidence: 88,
    findingId: "F1",
    supportingEvidence: [{ source: "diff:src/app.ts:14-18", content: "changed code" }],
    reachability: { credible: true, description: "direct path" },
    uncertaintyStatus: "supported",
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
    findingId: "F1",
    type: "must",
    title: "must above threshold",
    traceability: lineRangeTraceability(10, 12),
    confidence: 80
  });
  const mustBelow = finding({
    findingId: "F2",
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

test("StructuredOutputValidator filterByAcceptance filters findings by default acceptance gates", () => {
  const keptMust = finding({
    findingId: "F1",
    type: "must",
    title: "保留 must",
    traceability: lineRangeTraceability(20, 22),
    impact: "影響 correctness",
    confidence: 80
  });
  const keptNice = finding({
    findingId: "F2",
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
          findingId: "F3",
          type: "must",
          title: "移除 must",
          traceability: lineRangeTraceability(20, 21),
          impact: "影響 correctness",
          confidence: 79
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
          confidence: 89
        })
      ]),
      diffContent: DEFAULT_DIFF
    }),
    { findings: [keptMust, keptNice] }
  );
});

test("StructuredOutputValidator filterByAcceptance filters findings by supplied acceptance gates", () => {
  const keptMust = finding({
    findingId: "F1",
    type: "must",
    title: "保留 must",
    traceability: lineRangeTraceability(30, 30),
    impact: "影響 correctness",
    confidence: 70
  });
  const keptNice = finding({
    findingId: "F2",
    type: "nice",
    title: "保留 nice",
    traceability: lineRangeTraceability(30, 31),
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
          findingId: "F3",
          type: "must",
          title: "移除 must",
          traceability: lineRangeTraceability(30, 30),
          impact: "影響 correctness",
          confidence: 69
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

test("StructuredOutputValidator rejects evidence ref with empty source", () => {
  assertValidationFails({
    responseText: payload([
      finding({
        supportingEvidence: [{ source: "", content: "some content" }]
      })
    ])
  });
});

test("StructuredOutputValidator rejects evidence ref with empty content", () => {
  assertValidationFails({
    responseText: payload([
      finding({
        supportingEvidence: [{ source: "diff:src/app.ts:14", content: "" }]
      })
    ])
  });
});

test("StructuredOutputValidator rejects evidence ref with unknown fields", () => {
  assertValidationFails({
    responseText: payload([
      finding({
        supportingEvidence: [
          { source: "diff:src/app.ts:14", content: "excerpt", url: "http://x" }
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
      finding({ reachability: { credible: "yes", description: "path" } })
    ])
  });
});

test("StructuredOutputValidator rejects reachability with empty description", () => {
  assertValidationFails({
    responseText: payload([
      finding({ reachability: { credible: true, description: "" } })
    ])
  });
});

test("StructuredOutputValidator rejects reachability with unknown fields", () => {
  assertValidationFails({
    responseText: payload([
      finding({
        reachability: { credible: true, description: "path", path: "a→b" }
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
      findings: [f]
    });
  }
});

test("StructuredOutputValidator accepts optional sourceHypothesisId when non-empty", () => {
  const f = finding({ sourceHypothesisId: "W1" });
  assert.deepEqual(validate({ responseText: payload([f]) }), {
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
    confidence: 99
  });
  const supported = finding({
    findingId: "F-supp",
    uncertaintyStatus: "supported",
    confidence: 85
  });

  assert.deepEqual(
    validateAndFilter({
      responseText: payload([tentative, supported])
    }),
    { findings: [supported] }
  );
});

test("StructuredOutputValidator filterByAcceptance filters findings with credible=false", () => {
  const unreachable = finding({
    findingId: "F-unreach",
    reachability: { credible: false, description: "not reachable" },
    uncertaintyStatus: "supported",
    confidence: 95
  });
  const reachable = finding({
    findingId: "F-reach",
    reachability: { credible: true, description: "direct path" },
    uncertaintyStatus: "supported",
    confidence: 85
  });

  assert.deepEqual(
    validateAndFilter({
      responseText: payload([unreachable, reachable])
    }),
    { findings: [reachable] }
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

function verifiedPayload(findings: unknown[], dispositions: unknown[]): string {
  return JSON.stringify({ findings, dispositions });
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
  const f = finding();
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

test("validateWithDispositions accepts empty findings and dispositions", () => {
  const result = validateWithDispositions({
    responseText: verifiedPayload([], [])
  });

  assert.deepEqual(result, { findings: [], dispositions: [] });
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
          findings: [finding()],
          dispositions: [disposition()],
          metadata: {}
        })
      }),
    /unknown field/u
  );
});

test("validateWithDispositions rejects non-array dispositions", () => {
  assertDispositionValidationFails({
    label: "dispositions is object",
    responseText: JSON.stringify({ findings: [], dispositions: {} })
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
          [finding({ findingId: "F1" }), finding({ findingId: "F1" })],
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
  const f2 = finding({ findingId: "F2", traceability: lineRangeTraceability(21, 22), type: "nice", confidence: 75 });
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

test("filterByAcceptanceWithReport accepts supported/credible/high-confidence finding with OK taxonomy", () => {
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
  const f = finding({ traceability: lineRangeTraceability(21, 22), reachability: { credible: false, description: "unlikely" } });
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

test("filterByAcceptanceWithReport rejects low-confidence must finding with ACCEPTANCE taxonomy", () => {
  const validator = new StructuredOutputValidator({ confidenceThresholds: { must: 80, nice: 90 } });
  const f = finding({ traceability: lineRangeTraceability(21, 22), confidence: 50 });
  const validated = validator.validate({
    responseText: payload([f]),
    diffContent: DEFAULT_DIFF,
    filePath: "src/app.ts"
  });

  const result = validator.filterByAcceptanceWithReport(validated);
  assert.equal(result.payload.findings.length, 0);
  assert.equal(result.report.length, 1);
  assert.equal(result.report[0].taxonomy, "ACCEPTANCE");
  assert.equal(result.report[0].outcome, "rejected");
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
