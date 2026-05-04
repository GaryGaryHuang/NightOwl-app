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
    readonly schemaVersion: number;
    readonly findings: readonly {
      readonly findingId: string;
      readonly classification: string;
      readonly priority: string;
      readonly severity: string;
      readonly codeEvidence: readonly { readonly evidenceId: string }[];
    }[];
    readonly hypothesisClosure: readonly { readonly hypothesisId: string }[];
  };
  readonly report: readonly SemanticReportEntry[];
}

interface ValidationReportResult {
  readonly payload: {
    readonly schemaVersion: number;
    readonly overallStatus: string;
    readonly perFindingResults: readonly { readonly findingId: string }[];
    readonly approvedFindings: readonly { readonly findingId: string }[];
    readonly loopControl: { readonly action: string };
    readonly stopReason?: string;
  };
  readonly report: readonly SemanticReportEntry[];
}

function createReviewBasis(overrides: Partial<ReviewBasisV1> = {}): ReviewBasisV1 {
  return {
    schemaVersion: 1,
    filePath: "src/app.ts",
    roleInChangeset: "Owns review prompt harness state handoff.",
    changedBehavior: [
      {
        changeId: "CB1",
        before: "Step 5 consumed prose sections.",
        after: "Step 5 consumes ReviewBasis evidence graph.",
        evidenceIds: ["E1"]
      }
    ],
    facts: [
      {
        factId: "FCT1",
        statement: "ReviewBasis is emitted before Step 5.",
        evidenceIds: ["E1"]
      }
    ],
    inferences: [
      {
        inferenceId: "INF1",
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
    identifierRegistry: {
      files: ["src/app.ts"],
      symbols: ["ReviewBasisV1"],
      resourceKeys: [],
      apiNames: ["validateCandidateFindingsV3WithReport"],
      stateNames: ["reviewBasis"]
    },
    hypothesisLedger: [
      {
        hypothesisId: "H1",
        statement: "Nullable input may now dereference before fallback.",
        triggerCondition: "A nullable input reaches the changed branch.",
        whyRelevantHere: "The diff moves the guard after the dereference.",
        closureCriteria: ["Every approved finding must cite concrete code evidence."]
      },
      {
        hypothesisId: "H2",
        statement: "The unchanged fallback may still cover nullable input.",
        triggerCondition: "Fallback executes before any dereference.",
        whyRelevantHere: "Counter-evidence determines whether F1 is real.",
        closureCriteria: ["The hypothesis is rejected or converted to missing information."]
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
    findingId: "F1",
    sourceHypothesisIds: ["H1"],
    classification: "confirmed_problem",
    priority: "must",
    severity: "high",
    confidence: "high",
    evidenceStrength: "direct",
    title: "nullable input dereferences before fallback",
    traceability: lineRangeTraceability(21, 22),
    codeEvidence: [
      {
        evidenceId: "E1",
        location: "src/app.ts:21",
        summary: "changed branch reads input.value before checking for null"
      }
    ],
    executionPath: [
      "entry handler receives nullable input",
      "changed branch reads input.value"
    ],
    triggerCondition: "nullable input reaches the changed branch",
    failureMechanism: "guard was moved after dereference",
    impact: "requests with null input fail with a runtime TypeError",
    counterEvidenceChecked: [
      "existing fallback path no longer runs before dereference"
    ],
    reproducibility: "deterministic with nullable input",
    fixDirection: "restore guard before dereference",
    testRecommendation: "add nullable input regression coverage",
    ...overrides
  };
}

function hypothesisClosure(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    hypothesisId: "H1",
    status: "closed_by_candidate",
    evidenceIds: ["E1"],
    rationale: "candidate F1 covers the hypothesis",
    ...overrides
  };
}

function candidateFindingsV3(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    schemaVersion: 3,
    result: "FINDINGS_READY",
    findings: [candidateFinding()],
    hypothesisClosure: [
      hypothesisClosure(),
      hypothesisClosure({
        hypothesisId: "H2",
        status: "rejected_by_evidence",
        evidenceIds: ["E2"],
        rationale: "fallback no longer closes the nullable-input path"
      })
    ],
    criticalMissingInformation: [],
    ...overrides
  };
}

function approvedFinding(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    findingId: "F1",
    sourceHypothesisId: "H1",
    type: "must",
    title: "nullable input dereferences before fallback",
    traceability: lineRangeTraceability(21, 22),
    expectedBehavior: "nullable input returns the existing fallback before dereference",
    actualBehavior: "the changed code dereferences input.value before checking for null",
    deviation: "null input now throws instead of returning fallback",
    impact: "requests with null input fail with a runtime TypeError",
    suggestion: "restore the null guard before reading input.value",
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
    recommendedClassification: "confirmed_problem",
    recommendedPriority: "must",
    recommendedSeverity: "high",
    reason: "all semantic gates passed",
    ...overrides
  };
}

function validationReportV1(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    overallStatus: "PASS",
    perFindingResults: [perFindingResult()],
    approvedFindings: [approvedFinding()],
    missingInformationItems: [],
    loopControl: { action: "accept", reason: "all gates passed" },
    ...overrides
  };
}

function missingInformationItem(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    itemId: "MI1",
    findingId: "F1",
    description: "Need the service contract for null input handling.",
    whyItMatters: "Without the contract the validator cannot prove expected behavior.",
    ...overrides
  };
}

function validateCandidateFindings(
  payload: Record<string, unknown> = candidateFindingsV3(),
  reviewBasis: ReviewBasisV1 = createReviewBasis()
): CandidateValidationResult {
  return new StructuredOutputValidator().validateCandidateFindingsV3WithReport({
    responseText: JSON.stringify(payload),
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
  return new StructuredOutputValidator().validateValidationReportV1WithReport({
    responseText: JSON.stringify(payload),
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

  assert.equal(result.payload.schemaVersion, 3);
  assert.equal(result.payload.findings.length, 1);
  assert.equal(result.payload.findings[0]!.findingId, "F1");
  assert.equal(result.payload.findings[0]!.classification, "confirmed_problem");
  assert.equal(result.payload.findings[0]!.priority, "must");
  assert.equal(result.payload.findings[0]!.severity, "high");
  assert.deepEqual(
    result.payload.findings[0]!.codeEvidence.map((entry) => entry.evidenceId),
    ["E1"]
  );
  assert.deepEqual(
    result.payload.hypothesisClosure.map((entry) => entry.hypothesisId),
    ["H1", "H2"]
  );
  assert.equal(
    result.report.find((entry) => entry.findingId === "F1")?.outcome,
    "accepted"
  );
});

test("validateCandidateFindingsV3WithReport rejects schema and ReviewBasis semantic violations", () => {
  const invalidCases: readonly {
    readonly label: string;
    readonly payload: Record<string, unknown>;
    readonly reason: RegExp;
  }[] = [
    {
      label: "unsupported schemaVersion",
      payload: candidateFindingsV3({ schemaVersion: 2 }),
      reason: /schemaVersion.*3/u
    },
    {
      label: "invalid classification",
      payload: candidateFindingsV3({
        findings: [candidateFinding({ classification: "legacy_bug" })]
      }),
      reason: /classification.*confirmed_problem.*reasonable_risk.*insufficient_information/u
    },
    {
      label: "reasonable risk cannot be must priority",
      payload: candidateFindingsV3({
        findings: [
          candidateFinding({
            classification: "reasonable_risk",
            priority: "must",
            severity: "medium"
          })
        ]
      }),
      reason: /reasonable_risk.*priority.*must/u
    },
    {
      label: "reasonable risk cannot be high severity",
      payload: candidateFindingsV3({
        findings: [
          candidateFinding({
            classification: "reasonable_risk",
            priority: "nice",
            severity: "high"
          })
        ]
      }),
      reason: /reasonable_risk.*severity.*high/u
    },
    {
      label: "insufficient information cannot be must priority",
      payload: candidateFindingsV3({
        findings: [
          candidateFinding({
            classification: "insufficient_information",
            priority: "must",
            severity: "none"
          })
        ]
      }),
      reason: /insufficient_information.*priority.*must/u
    },
    {
      label: "insufficient information must use none severity",
      payload: candidateFindingsV3({
        findings: [
          candidateFinding({
            classification: "insufficient_information",
            priority: "none",
            severity: "low"
          })
        ]
      }),
      reason: /insufficient_information.*severity.*none/u
    },
    {
      label: "confirmed problem requires code evidence",
      payload: candidateFindingsV3({
        findings: [candidateFinding({ codeEvidence: [] })]
      }),
      reason: /codeEvidence/u
    },
    {
      label: "confirmed problem requires execution path",
      payload: candidateFindingsV3({
        findings: [candidateFinding({ executionPath: [] })]
      }),
      reason: /executionPath/u
    },
    {
      label: "confirmed problem requires trigger condition",
      payload: candidateFindingsV3({
        findings: [candidateFinding({ triggerCondition: "" })]
      }),
      reason: /triggerCondition/u
    },
    {
      label: "confirmed problem requires failure mechanism",
      payload: candidateFindingsV3({
        findings: [candidateFinding({ failureMechanism: "" })]
      }),
      reason: /failureMechanism/u
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
        findings: [candidateFinding({ counterEvidenceChecked: [] })]
      }),
      reason: /counterEvidenceChecked/u
    },
    {
      label: "confirmed problem requires reproducibility",
      payload: candidateFindingsV3({
        findings: [candidateFinding({ reproducibility: "" })]
      }),
      reason: /reproducibility/u
    },
    {
      label: "confirmed problem requires fix direction",
      payload: candidateFindingsV3({
        findings: [candidateFinding({ fixDirection: "" })]
      }),
      reason: /fixDirection/u
    },
    {
      label: "confirmed problem requires test recommendation",
      payload: candidateFindingsV3({
        findings: [candidateFinding({ testRecommendation: "" })]
      }),
      reason: /testRecommendation/u
    },
    {
      label: "code evidence must reference ReviewBasis evidenceRefs",
      payload: candidateFindingsV3({
        findings: [
          candidateFinding({
            codeEvidence: [
              {
                evidenceId: "E404",
                location: "src/app.ts:21",
                summary: "missing evidence ref"
              }
            ]
          })
        ]
      }),
      reason: /E404.*evidenceRefs/u
    },
    {
      label: "source hypotheses must reference ReviewBasis hypothesisLedger",
      payload: candidateFindingsV3({
        findings: [candidateFinding({ sourceHypothesisIds: ["H404"] })]
      }),
      reason: /H404.*hypothesisLedger/u
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

  assert.equal(result.payload.schemaVersion, 1);
  assert.equal(result.payload.overallStatus, "PASS");
  assert.deepEqual(
    result.payload.perFindingResults.map((entry) => entry.findingId),
    ["F1"]
  );
  assert.deepEqual(
    result.payload.approvedFindings.map((entry) => entry.findingId),
    ["F1"]
  );
  assert.equal(result.payload.loopControl.action, "accept");
  assert.equal(
    result.report.find((entry) => entry.findingId === "F1")?.outcome,
    "accepted"
  );
});

test("validateValidationReportV1WithReport enforces candidate coverage and approved finding consistency", () => {
  const twoCandidates = candidateFindingsV3({
    findings: [
      candidateFinding({ findingId: "F1" }),
      candidateFinding({
        findingId: "F2",
        sourceHypothesisIds: ["H2"],
        codeEvidence: [
          {
            evidenceId: "E2",
            location: "src/app.ts:24",
            summary: "fallback evidence"
          }
        ]
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
      label: "approvedFindings cannot add new findings",
      payload: validationReportV1({
        approvedFindings: [approvedFinding({ findingId: "F404" })]
      }),
      reason: /F404.*approvedFindings.*candidate/u
    },
    {
      label: "dropped candidates cannot be approved",
      payload: validationReportV1({
        perFindingResults: [perFindingResult({ decision: "drop" })],
        approvedFindings: [approvedFinding()]
      }),
      reason: /drop.*approvedFindings/u
    },
    {
      label: "converted candidates cannot be approved",
      payload: validationReportV1({
        overallStatus: "INSUFFICIENT_INFORMATION_FOR_RELIABLE_REVIEW",
        perFindingResults: [
          perFindingResult({
            decision: "convert_to_missing_information",
            failedGates: ["missing_information_honest"],
            reason: "required external contract is unavailable"
          })
        ],
        approvedFindings: [approvedFinding()],
        missingInformationItems: [missingInformationItem()],
        loopControl: { action: "stop", reason: "missing critical contract" },
        stopReason: "missing_critical_contract"
      }),
      reason: /convert_to_missing_information.*approvedFindings/u
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

test("validateValidationReportV1WithReport validates loopControl actions and stop reasons", () => {
  const acceptedActions: readonly {
    readonly action: string;
    readonly payload: Record<string, unknown>;
  }[] = [
    { action: "accept", payload: validationReportV1() },
    {
      action: "rerun_step5",
      payload: validationReportV1({
        overallStatus: "RERUN_STEP5",
        perFindingResults: [
          perFindingResult({
            decision: "rewrite_required",
            failedGates: ["impact_proportionate"],
            requiredCorrections: [
              "Prove concrete user impact or convert to missing information."
            ],
            reason: "impact is asserted but not proven"
          })
        ],
        approvedFindings: [],
        loopControl: {
          action: "rerun_step5",
          reason: "Step 5 must repair machine-actionable evidence gaps"
        }
      })
    },
    {
      action: "stop",
      payload: validationReportV1({
        overallStatus: "INSUFFICIENT_INFORMATION_FOR_RELIABLE_REVIEW",
        perFindingResults: [
          perFindingResult({
            decision: "convert_to_missing_information",
            failedGates: ["missing_information_honest"],
            reason: "required external contract is unavailable"
          })
        ],
        approvedFindings: [],
        missingInformationItems: [missingInformationItem()],
        loopControl: { action: "stop", reason: "missing critical contract" },
        stopReason: "missing_critical_contract"
      })
    }
  ];

  for (const testCase of acceptedActions) {
    const result = validateValidationReport(testCase.payload);
    assert.equal(result.payload.loopControl.action, testCase.action);
  }

  for (const stopReason of [
    "missing_critical_contract",
    "repeated_unsupported_claim",
    "unresolved_identifier_hallucination",
    "max_semantic_reruns"
  ]) {
    const result = validateValidationReport(
      validationReportV1({
        overallStatus: "INSUFFICIENT_INFORMATION_FOR_RELIABLE_REVIEW",
        perFindingResults: [
          perFindingResult({
            decision: "convert_to_missing_information",
            failedGates: ["missing_information_honest"],
            reason: "approval is blocked by a stop condition"
          })
        ],
        approvedFindings: [],
        missingInformationItems: [missingInformationItem()],
        loopControl: { action: "stop", reason: stopReason },
        stopReason
      })
    );
    assert.equal(result.payload.stopReason, stopReason);
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
      reason: /loopControl\.action.*accept.*rerun_step5.*stop/u
    },
    {
      label: "PASS requires accept",
      payload: validationReportV1({
        approvedFindings: [],
        loopControl: {
          action: "rerun_step5",
          reason: "status/action mismatch"
        }
      }),
      reason: /PASS.*accept/u
    },
    {
      label: "rerun cannot approve findings",
      payload: validationReportV1({
        overallStatus: "RERUN_STEP5",
        loopControl: {
          action: "rerun_step5",
          reason: "Step 5 must repair evidence gaps"
        }
      }),
      reason: /rerun_step5.*approve findings/u
    },
    {
      label: "stop requires stopReason",
      payload: validationReportV1({
        overallStatus: "STOPPED",
        perFindingResults: [
          perFindingResult({
            decision: "convert_to_missing_information",
            failedGates: ["missing_information_honest"],
            reason: "approval is blocked by a stop condition"
          })
        ],
        approvedFindings: [],
        missingInformationItems: [missingInformationItem()],
        loopControl: { action: "stop", reason: "missing critical contract" }
      }),
      reason: /stop.*requires stopReason/u
    },
    {
      label: "accept cannot carry stopReason",
      payload: validationReportV1({
        stopReason: "max_semantic_reruns"
      }),
      reason: /accepted.*must not include stopReason/u
    },
    {
      label: "invalid stopReason",
      payload: validationReportV1({
        overallStatus: "INSUFFICIENT_INFORMATION_FOR_RELIABLE_REVIEW",
        perFindingResults: [
          perFindingResult({
            decision: "convert_to_missing_information",
            failedGates: ["missing_information_honest"],
            reason: "approval is blocked by a stop condition"
          })
        ],
        approvedFindings: [],
        missingInformationItems: [missingInformationItem()],
        loopControl: { action: "stop", reason: "format retry exhausted" },
        stopReason: "format_retry_exhausted"
      }),
      reason: /stopReason.*missing_critical_contract.*repeated_unsupported_claim.*unresolved_identifier_hallucination.*max_semantic_reruns/u
    }
  ];

  for (const testCase of invalidCases) {
    const error = captureStructuredValidationReportError(
      () => validateValidationReport(testCase.payload)
    );

    assert.match(reportReasons(error), testCase.reason, testCase.label);
  }
});
