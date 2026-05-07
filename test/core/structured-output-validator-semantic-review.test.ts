import assert from "node:assert/strict";
import test from "node:test";

import type { ReviewBasisV1 } from "../../src/core/review-basis.ts";
import {
  StructuredOutputValidator,
  StructuredValidationReportError
} from "../../src/core/structured-output-validator.ts";
import {
  DEFAULT_DIFF,
  lineRangeTraceability
} from "../helpers/structured-output-validator-fixture.ts";

interface SemanticReportEntry {
  readonly findingId?: string;
  readonly taxonomy?: string;
  readonly outcome?: string;
  readonly gate?: string;
  readonly reason?: string;
}

interface CandidateValidationResult {
  readonly payload: {
    readonly findings: readonly {
      readonly findingId: string;
      readonly classification: string;
      readonly severity: string;
    }[];
    readonly hypothesisClosure: readonly { readonly hypothesisId: string }[];
  };
  readonly report: readonly SemanticReportEntry[];
}

interface ValidationReportResult {
  readonly payload: {
    readonly perFindingResults: readonly { readonly findingId: string }[];
    readonly loopControl: { readonly action: string };
  };
  readonly report: readonly SemanticReportEntry[];
}

function createReviewBasis(overrides: Partial<ReviewBasisV1> = {}): ReviewBasisV1 {
  return {
    filePath: "src/app.ts",
    roleInChangeset: "Owns review prompt harness state handoff.",
    changedBehavior: [
      {
        before: "Step 5 consumed prose sections.",
        after: "Step 5 consumes ReviewBasis evidence graph.",
        evidenceIds: ["E1"]
      }
    ],
    facts: [
      {
        statement: "ReviewBasis is emitted before Step 5.",
        evidenceIds: ["E1"]
      }
    ],
    inferences: [
      {
        statement: "Step 5 can validate source evidence IDs.",
        basedOnEvidenceIds: ["E1"],
        confidence: "high"
      }
    ],
    dependencyMap: {
      upstreamCallers: ["ReviewOrchestrator"],
      downstreamConsumers: ["Step5ValidationInterrogationStep"],
      externalContracts: [],
      sharedStateOrSideEffects: ["FileReviewContext"]
    },
    flowMap: {
      entryPoints: ["ReviewBasisStep.prepare"],
      stateTransitions: ["setReviewBasis"],
      asyncBoundaries: [],
      errorPaths: ["validator rejects missing evidence"]
    },
    testCoverage: {
      changedTests: ["test/core/review-basis-validator.test.ts"],
      observedCoverageSignals: ["validator tests"],
      coverageGaps: []
    },
    hypothesisLedger: [
      {
        hypothesisId: "H1",
        statement: "Nullable input may now dereference before fallback.",
        triggerCondition: "A nullable input reaches the changed branch.",
      },
      {
        hypothesisId: "H2",
        statement: "The unchanged fallback may still cover nullable input.",
        triggerCondition: "Fallback executes before any dereference.",
      }
    ],
    missingInformation: [],
    evidenceRefs: [
      {
        evidenceId: "E1",
        sourceType: "diff",
        location: "src/app.ts:21",
        summary: "changed branch dereferences input.value before fallback"
      },
      {
        evidenceId: "E2",
        sourceType: "file",
        location: "src/app.ts:24",
        summary: "fallback remains reachable only after the dereference"
      }
    ],
    ...overrides
  };
}

function candidateFinding(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    classification: "confirmed_problem",
    severity: "high",
    title: "nullable input dereferences before fallback",
    traceability: lineRangeTraceability(21, 22),
    evidence: "changed branch reads input.value before checking for null; guard was moved after dereference",
    triggerCondition: "nullable input reaches the changed branch",
    impact: "requests with null input fail with a runtime TypeError",
    counterEvidence: [
      "existing fallback path no longer runs before dereference"
    ],
    ...overrides
  };
}

function hypothesisClosure(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    hypothesisId: "H1",
    status: "closed_by_candidate",
    rationale: "candidate F1 covers the hypothesis",
    ...overrides
  };
}

function candidateFindingsV3(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    findings: [candidateFinding()],
    hypothesisClosure: [
      hypothesisClosure(),
      hypothesisClosure({
        hypothesisId: "H2",
        status: "rejected_by_evidence",
        rationale: "fallback no longer closes the nullable-input path"
      })
    ],
    criticalMissingInformation: [],
    ...overrides
  };
}

function perFindingResult(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    findingId: "F1",
    decision: "approve",
    failedGates: [],
    requiredCorrections: [],
    reason: "all semantic gates passed",
    ...overrides
  };
}

function validationReportV1(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    perFindingResults: [perFindingResult()],
    missingInformationItems: [],
    loopControl: { action: "accept", reason: "all gates passed" },
    ...overrides
  };
}

function missingInformationItem(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    description: "Need the service contract for null input handling.",
    whyItMatters: "Without the contract the validator cannot prove expected behavior.",
    ...overrides
  };
}

function validateCandidateFindings(
  payload: Record<string, unknown> = candidateFindingsV3(),
  reviewBasis: ReviewBasisV1 = createReviewBasis()
): CandidateValidationResult {
  return validateCandidateFindingsText(JSON.stringify(payload), reviewBasis);
}

function validateCandidateFindingsText(
  responseText: string,
  reviewBasis: ReviewBasisV1 = createReviewBasis()
): CandidateValidationResult {
  return new StructuredOutputValidator().validateCandidateFindingsV3WithReport({
    responseText,
    reviewBasis,
    diffContent: DEFAULT_DIFF,
    filePath: reviewBasis.filePath
  });
}

function validateValidationReport(
  payload: Record<string, unknown> = validationReportV1(),
  candidateFindings: Record<string, unknown> = candidateFindingsV3(),
  reviewBasis: ReviewBasisV1 = createReviewBasis()
): ValidationReportResult {
  return validateValidationReportText(JSON.stringify(payload), candidateFindings, reviewBasis);
}

function validateValidationReportText(
  responseText: string,
  candidateFindings: Record<string, unknown> = candidateFindingsV3(),
  reviewBasis: ReviewBasisV1 = createReviewBasis()
): ValidationReportResult {
  return new StructuredOutputValidator().validateValidationReportV1WithReport({
    responseText,
    candidateFindings,
    reviewBasis,
    diffContent: DEFAULT_DIFF,
    filePath: reviewBasis.filePath
  });
}

function captureStructuredValidationReportError(
  callback: () => unknown
): StructuredValidationReportError {
  try {
    callback();
  } catch (error) {
    if (!(error instanceof StructuredValidationReportError)) {
      throw error;
    }
    return error;
  }

  assert.fail("Expected StructuredValidationReportError");
}

function reportReasons(error: StructuredValidationReportError): string {
  return error.report.map((entry) => entry.reason ?? "").join("\n");
}

test("validateCandidateFindingsV3WithReport accepts evidence-chain candidates tied to ReviewBasisV1", () => {
  const result = validateCandidateFindings();

  assert.equal(result.payload.findings.length, 1);
  assert.equal(result.payload.findings[0]!.findingId, "F1");
  assert.equal(result.payload.findings[0]!.classification, "confirmed_problem");
  assert.equal(result.payload.findings[0]!.severity, "high");
  assert.deepEqual(
    result.payload.hypothesisClosure.map((entry) => entry.hypothesisId),
    ["H1", "H2"]
  );
  assert.equal(
    result.report.find((entry) => entry.findingId === "F1")?.outcome,
    "accepted"
  );
});

test("validateCandidateFindingsV3WithReport repairs fenced or prose-wrapped single JSON objects", () => {
  const payload = JSON.stringify(candidateFindingsV3());

  assert.equal(
    validateCandidateFindingsText(`\uFEFF\`\`\`json\n${payload}\n\`\`\``).payload.findings[0]?.findingId,
    "F1"
  );
  assert.equal(
    validateCandidateFindingsText(`Here is the JSON:\n${payload}\nDone.`).payload.findings[0]?.findingId,
    "F1"
  );
});

test("validateCandidateFindingsV3WithReport ignores non-contract extra fields", () => {
  const result = validateCandidateFindings(
    candidateFindingsV3({
      schemaVersion: 3,
      findings: [
        candidateFinding({
          priority: "must",
          traceability: {
            ...lineRangeTraceability(21, 22),
            legacyAnchorHint: "ignored"
          },
          legacyFindingMetadata: {
            confidence: "high"
          }
        })
      ],
      hypothesisClosure: [
        hypothesisClosure({ evidenceIds: ["E1"] }),
        hypothesisClosure({
          hypothesisId: "H2",
          status: "rejected_by_evidence",
          rationale: "fallback no longer closes the nullable-input path",
          evidenceIds: ["E2"]
        })
      ]
    })
  );

  assert.equal(result.payload.findings[0]?.findingId, "F1");
  assert.equal(result.payload.findings[0]?.classification, "confirmed_problem");
});

test("validateCandidateFindingsV3WithReport rejects schema and ReviewBasis semantic violations", () => {
  const invalidCases: readonly {
    readonly label: string;
    readonly payload: Record<string, unknown>;
    readonly reason: RegExp;
  }[] = [
    {
      label: "invalid classification",
      payload: candidateFindingsV3({
        findings: [candidateFinding({ classification: "legacy_bug" })]
      }),
      reason: /classification.*confirmed_problem.*reasonable_risk/u
    },
    {
      label: "invalid severity",
      payload: candidateFindingsV3({
        findings: [candidateFinding({ severity: "medium" })]
      }),
      reason: /severity.*high.*low/u
    },
    {
      label: "confirmed problem requires trigger condition",
      payload: candidateFindingsV3({
        findings: [candidateFinding({ triggerCondition: "" })]
      }),
      reason: /triggerCondition/u
    },
    {
      label: "confirmed problem requires impact",
      payload: candidateFindingsV3({
        findings: [candidateFinding({ impact: "" })]
      }),
      reason: /impact/u
    },
    {
      label: "confirmed problem requires counter-evidence",
      payload: candidateFindingsV3({
        findings: [candidateFinding({ counterEvidence: [] })]
      }),
      reason: /counterEvidence/u
    },
    {
      label: "confirmed problem requires evidence",
      payload: candidateFindingsV3({
        findings: [candidateFinding({ evidence: "" })]
      }),
      reason: /evidence/u
    },
    {
      label: "hypothesis closure must cover every ReviewBasis hypothesis",
      payload: candidateFindingsV3({
        hypothesisClosure: [hypothesisClosure({ hypothesisId: "H1" })]
      }),
      reason: /H2.*hypothesisClosure/u
    }
  ];

  for (const testCase of invalidCases) {
    const error = captureStructuredValidationReportError(
      () => validateCandidateFindings(testCase.payload)
    );

    assert.match(reportReasons(error), testCase.reason, testCase.label);
  }
});

test("validateValidationReportV1WithReport accepts reports that approve only Step 5 candidates", () => {
  const result = validateValidationReport();

  assert.deepEqual(
    result.payload.perFindingResults.map((entry) => entry.findingId),
    ["F1"]
  );
  assert.equal(result.payload.loopControl.action, "accept");
  assert.equal(
    result.report.find((entry) => entry.findingId === "F1")?.outcome,
    "accepted"
  );
});

test("validateValidationReportV1WithReport repairs fenced or prose-wrapped single JSON objects", () => {
  const payload = JSON.stringify(validationReportV1());

  assert.equal(
    validateValidationReportText(`\`\`\`json\n${payload}\n\`\`\``).payload.perFindingResults[0]?.findingId,
    "F1"
  );
  assert.equal(
    validateValidationReportText(`Result:\n${payload}`).payload.loopControl.action,
    "accept"
  );
});

test("validateValidationReportV1WithReport ignores non-contract extra fields", () => {
  const result = validateValidationReport(
    validationReportV1({
      overallStatus: "PASS",
      approvedFindings: [],
      perFindingResults: [
        perFindingResult({
          recommendedSeverity: "high"
        })
      ],
      loopControl: {
        action: "accept",
        reason: "all gates passed",
        stopReason: "ignored"
      }
    })
  );

  assert.equal(result.payload.perFindingResults[0]?.findingId, "F1");
  assert.equal(result.payload.loopControl.action, "accept");
});

test("validateValidationReportV1WithReport enforces candidate coverage and approved finding consistency", () => {
  const twoCandidates = candidateFindingsV3({
    findings: [
      candidateFinding(),
      candidateFinding({
        title: "second finding"
      })
    ]
  });
  const invalidCases: readonly {
    readonly label: string;
    readonly payload: Record<string, unknown>;
    readonly candidates?: Record<string, unknown>;
    readonly reason: RegExp;
  }[] = [
    {
      label: "perFindingResults must cover every candidate",
      payload: validationReportV1(),
      candidates: twoCandidates,
      reason: /F2.*perFindingResults/u
    },
    {
      label: "perFindingResults cannot reference unknown candidates",
      payload: validationReportV1({
        perFindingResults: [
          perFindingResult(),
          perFindingResult({ findingId: "F404", decision: "drop" })
        ]
      }),
      reason: /F404.*candidate/u
    },
    {
      label: "candidateFindings must be a valid payload",
      payload: validationReportV1(),
      candidates: { findings: "not-an-array" },
      reason: /findings.*array/u
    }
  ];

  for (const testCase of invalidCases) {
    const error = captureStructuredValidationReportError(
      () => validateValidationReport(
        testCase.payload,
        testCase.candidates ?? candidateFindingsV3()
      )
    );

    assert.match(reportReasons(error), testCase.reason, testCase.label);
  }
});

test("validateValidationReportV1WithReport validates loopControl actions", () => {
  const acceptedActions: readonly {
    readonly action: string;
    readonly payload: Record<string, unknown>;
  }[] = [
    { action: "accept", payload: validationReportV1() },
    {
      action: "rerun",
      payload: validationReportV1({
        perFindingResults: [
          perFindingResult({
            decision: "rewrite_required",
            failedGates: ["impact"],
            requiredCorrections: [
              "Prove concrete user impact or convert to missing information."
            ],
            reason: "impact is asserted but not proven"
          })
        ],
        loopControl: {
          action: "rerun",
          reason: "Step 5 must repair machine-actionable evidence gaps"
        }
      })
    }
  ];

  for (const testCase of acceptedActions) {
    const result = validateValidationReport(testCase.payload);
    assert.equal(result.payload.loopControl.action, testCase.action);
  }

  const invalidCases: readonly {
    readonly label: string;
    readonly payload: Record<string, unknown>;
    readonly reason: RegExp;
  }[] = [
    {
      label: "invalid loopControl action",
      payload: validationReportV1({
        loopControl: { action: "retry_step_runner", reason: "wrong retry budget" }
      }),
      reason: /loopControl\.action.*accept.*rerun/u
    },
    {
      label: "rerun cannot approve findings",
      payload: validationReportV1({
        loopControl: {
          action: "rerun",
          reason: "Step 5 must repair evidence gaps"
        }
      }),
      reason: /rerun.*approve findings/u
    }
  ];

  for (const testCase of invalidCases) {
    const error = captureStructuredValidationReportError(
      () => validateValidationReport(testCase.payload)
    );

    assert.match(reportReasons(error), testCase.reason, testCase.label);
  }
});
