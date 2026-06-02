import assert from "node:assert/strict";
import test from "node:test";

import type { ReviewBasis } from "../../src/core/review-basis.ts";
import {
  StructuredOutputValidator,
  StructuredValidationReportError
} from "../../src/core/structured-output-validator.ts";

const DEFAULT_HUNK_HEADER = "@@ -20,2 +20,4 @@";
const DEFAULT_DIFF = [
  DEFAULT_HUNK_HEADER,
  " context-before",
  "+added-21",
  "+added-22",
  " context-after"
].join("\n");

test("StructuredOutputValidator rejects invalid CandidateFindings traceability payloads", () => {
  const cases: Array<{
    label: string;
    traceability?: Record<string, unknown>;
  }> = [
    { label: "missing traceability", traceability: undefined },
    {
      label: "unsupported traceability kind",
      traceability: { kind: "file-offset", offsetStart: 1, offsetEnd: 2 }
    },
    {
      label: "line-range inverted bounds",
      traceability: { kind: "line-range", lineStart: 20, lineEnd: 19 }
    },
    {
      label: "lineStart is zero",
      traceability: { kind: "line-range", lineStart: 0, lineEnd: 5 }
    },
    {
      label: "lineEnd is negative",
      traceability: { kind: "line-range", lineStart: 1, lineEnd: -1 }
    },
    {
      label: "diff-hunk missing hunkHeader",
      traceability: { kind: "diff-hunk" }
    }
  ];

  for (const testCase of cases) {
    assertCandidateValidationFails(
      createCandidatePayload({ traceability: testCase.traceability }),
      testCase.label
    );
  }
});

test("StructuredOutputValidator accepts CandidateFindings line-range outside changed head lines", () => {
  const result = validateCandidatePayload(
    createCandidatePayload({
      traceability: { kind: "line-range", lineStart: 14, lineEnd: 18 }
    })
  );

  assert.deepEqual(result.payload.findings[0]?.traceability, {
    kind: "line-range",
    lineStart: 14,
    lineEnd: 18
  });
});

test("StructuredOutputValidator accepts CandidateFindings dependency path exception outside changed head lines", () => {
  const result = validateCandidatePayload(
    createCandidatePayload({
      traceability: { kind: "line-range", lineStart: 14, lineEnd: 18 },
      dependencyPathException: {
        reason: "dependency path is causally linked to the changed call site",
        dependencyAnchor: { filePath: "src/dep.ts", symbol: "helper" }
      }
    })
  );

  assert.equal(
    result.payload.findings[0]?.dependencyPathException?.dependencyAnchor.symbol,
    "helper"
  );
});

test("StructuredOutputValidator accepts CandidateFindings line-range on changed head lines", () => {
  const result = validateCandidatePayload(
    createCandidatePayload({
      traceability: { kind: "line-range", lineStart: 21, lineEnd: 22 }
    })
  );

  assert.deepEqual(result.payload.findings[0]?.traceability, {
    kind: "line-range",
    lineStart: 21,
    lineEnd: 22
  });
});

test("StructuredOutputValidator accepts CandidateFindings diff-hunk with trimmed header", () => {
  const result = validateCandidatePayload(
    createCandidatePayload({
      traceability: { kind: "diff-hunk", hunkHeader: `  ${DEFAULT_HUNK_HEADER}  ` }
    })
  );

  assert.deepEqual(result.payload.findings[0]?.traceability, {
    kind: "diff-hunk",
    hunkHeader: DEFAULT_HUNK_HEADER
  });
});

function validateCandidatePayload(payload: Record<string, unknown>) {
  return new StructuredOutputValidator().validateCandidateFindingsWithReport({
    responseText: JSON.stringify(payload),
    reviewBasis: createReviewBasis(),
    diffContent: DEFAULT_DIFF,
    filePath: "src/app.ts"
  });
}

function assertCandidateValidationFails(
  payload: Record<string, unknown>,
  label: string
): StructuredValidationReportError {
  assert.throws(
    () => validateCandidatePayload(payload),
    (error: unknown) => {
      assert.equal(error instanceof StructuredValidationReportError, true, label);
      return true;
    },
    label
  );

  try {
    validateCandidatePayload(payload);
  } catch (error) {
    return error as StructuredValidationReportError;
  }

  throw new Error(`expected validation failure for ${label}`);
}

function createCandidatePayload(
  findingOverrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    findings: [
      {
        priority: "must_fix",
        title: "guard moved after dereference",
        traceability: { kind: "line-range", lineStart: 21, lineEnd: 22 },
        evidence: "changed branch reads value before fallback; guard runs after dereference",
        triggerCondition: "nullable input reaches the changed branch",
        impact: "request fails before fallback can run",
        counterEvidence: ["fallback no longer precedes dereference"],
        ...findingOverrides
      }
    ],
    findingOrigins: [
      {
        findingIndex: 1,
        kind: "hypothesis",
        hypothesisIds: ["H1"],
        evidenceIds: ["E1"],
        rationale: "candidate covers H1"
      }
    ],
    hypothesisClosure: [
      {
        hypothesisId: "H1",
        status: "closed_by_candidate",
        rationale: "F1 validates the hypothesis."
      }
    ],
    criticalMissingInformation: []
  };
}

function createReviewBasis(): ReviewBasis {
  return {
    filePath: "src/app.ts",
    roleInChangeset: "Owns review prompt harness state handoff.",
    changedBehavior: [
      {
        before: "Candidate Findings consumed prose sections.",
        after: "Candidate Findings consumes ReviewBasis evidence graph.",
        evidenceIds: ["E1"]
      }
    ],
    facts: [
      {
        statement: "ReviewBasis is emitted before Candidate Findings.",
        evidenceIds: ["E1"]
      }
    ],
    inferences: [
      {
        statement: "Candidate Findings can validate source evidence IDs.",
        basedOnEvidenceIds: ["E1"],
        confidence: "high"
      }
    ],
    dependencyMap: {
      upstreamCallers: ["ReviewOrchestrator"],
      downstreamConsumers: ["CandidateFindingsStep"],
      externalContracts: [],
      sharedStateOrSideEffects: ["FileReviewContext"]
    },
        flowMap: {
      entryPoints: ["ReviewBasisStep.prepare"],
      stateTransitions: ["setReviewBasis"],
      asyncBoundaries: [],
      errorPaths: ["validator rejects missing evidence"]
    },
    hypothesisLedger: [
      {
        hypothesisId: "H1",
        statement: "Evidence refs may be missing.",
        triggerCondition: "Candidate Findings cites absent evidence ID.",
      }
    ],
    missingInformation: [],
    evidenceRefs: [
      {
        evidenceId: "E1",
        sourceType: "diff",
        location: "src/app.ts:21",
        summary: "review basis state added"
      }
    ]
  };
}
