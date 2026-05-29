import assert from "node:assert/strict";
import test from "node:test";

import type { ReviewBasisV1 } from "../../src/core/review-basis.ts";
import type { CandidateFindings } from "../../src/core/semantic-review.ts";
import {
  StructuredOutputValidator,
  StructuredValidationReportError
} from "../../src/core/structured-output-validator.ts";

const DEFAULT_DIFF = [
  "@@ -20,2 +20,4 @@",
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

interface SemanticReportEntry {
  readonly findingId?: string;
  readonly taxonomy?: string;
  readonly outcome?: string;
  readonly gate?: string;
  readonly reason?: string;
}

interface CandidateValidationResult {
  readonly payload: {
    readonly result: string;
    readonly findings: readonly {
      readonly findingId: string;
      readonly classification: string;
      readonly severity: string;
      readonly traceability?: unknown;
    }[];
    readonly findingOrigins: readonly {
      readonly findingIndex: number;
      readonly kind: string;
      readonly hypothesisIds?: readonly string[];
      readonly lens?: string;
      readonly evidenceIds: readonly string[];
      readonly rationale: string;
      readonly relatedHypothesisIds?: readonly string[];
    }[];
    readonly hypothesisClosure: readonly { readonly hypothesisId: string }[];
    readonly criticalMissingInformation: readonly unknown[];
  };
  readonly report: readonly SemanticReportEntry[];
}

interface ValidationReportResult {
  readonly payload: {
    readonly perFindingResults: readonly {
      readonly findingId: string;
      readonly failedGates: readonly string[];
      readonly requiredCorrections: readonly string[];
    }[];
    readonly missingInformationItems: readonly unknown[];
    readonly loopControl: { readonly action: string; readonly reason: string };
  };
  readonly report: readonly SemanticReportEntry[];
}

function createReviewBasis(overrides: Partial<ReviewBasisV1> = {}): ReviewBasisV1 {
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

function hypothesisFindingOrigin(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    findingIndex: 1,
    kind: "hypothesis",
    hypothesisIds: ["H1"],
    evidenceIds: ["E1"],
    rationale: "candidate covers H1",
    ...overrides
  };
}

function supplementalFindingOrigin(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    findingIndex: 1,
    kind: "supplemental",
    lens: "changed_behavior_sweep",
    evidenceIds: ["E1"],
    rationale: "changed behavior exposes a directly reviewed issue",
    relatedHypothesisIds: [],
    ...overrides
  };
}

function candidateFindings(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    findings: [candidateFinding()],
    findingOrigins: [hypothesisFindingOrigin()],
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
  payload: Record<string, unknown> = candidateFindings(),
  reviewBasis: ReviewBasisV1 = createReviewBasis(),
  previousCandidateFindings?: CandidateFindings
): CandidateValidationResult {
  return validateCandidateFindingsText(
    JSON.stringify(payload),
    reviewBasis,
    previousCandidateFindings
  );
}

function validateCandidateFindingsText(
  responseText: string,
  reviewBasis: ReviewBasisV1 = createReviewBasis(),
  previousCandidateFindings?: CandidateFindings
): CandidateValidationResult {
  return new StructuredOutputValidator().validateCandidateFindingsWithReport({
    responseText,
    reviewBasis,
    ...(previousCandidateFindings === undefined
      ? {}
      : { previousCandidateFindings }),
    diffContent: DEFAULT_DIFF,
    filePath: reviewBasis.filePath
  });
}

function validateValidationReport(
  payload: Record<string, unknown> = validationReportV1(),
  candidatePayload: Record<string, unknown> = candidateFindings(),
  reviewBasis: ReviewBasisV1 = createReviewBasis()
): ValidationReportResult {
  return validateValidationReportText(JSON.stringify(payload), candidatePayload, reviewBasis);
}

function validateValidationReportText(
  responseText: string,
  candidatePayload: Record<string, unknown> = candidateFindings(),
  reviewBasis: ReviewBasisV1 = createReviewBasis()
): ValidationReportResult {
  return new StructuredOutputValidator().validateValidationReportV1WithReport({
    responseText,
    candidateFindings: candidatePayload,
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

test("validateCandidateFindingsWithReport accepts evidence-chain candidates tied to ReviewBasisV1", () => {
  const result = validateCandidateFindings();

  assert.equal(result.payload.findings.length, 1);
  assert.equal(result.payload.findings[0]!.findingId, "F1");
  assert.equal(result.payload.findings[0]!.classification, "confirmed_problem");
  assert.equal(result.payload.findings[0]!.severity, "high");
  assert.deepEqual(
    result.payload.hypothesisClosure.map((entry) => entry.hypothesisId),
    ["H1", "H2"]
  );
  assert.deepEqual(result.payload.findingOrigins, [
    {
      findingIndex: 1,
      kind: "hypothesis",
      hypothesisIds: ["H1"],
      evidenceIds: ["E1"],
      rationale: "candidate covers H1"
    }
  ]);
  assert.equal(
    result.report.find((entry) => entry.findingId === "F1")?.outcome,
    "accepted"
  );
});

test("validateCandidateFindingsWithReport repairs fenced or prose-wrapped single JSON objects", () => {
  const payload = JSON.stringify(candidateFindings());

  assert.equal(
    validateCandidateFindingsText(`\uFEFF\`\`\`json\n${payload}\n\`\`\``).payload.findings[0]?.findingId,
    "F1"
  );
  assert.equal(
    validateCandidateFindingsText(`Here is the JSON:\n${payload}\nDone.`).payload.findings[0]?.findingId,
    "F1"
  );
});

test("validateCandidateFindingsWithReport ignores non-contract extra fields", () => {
  const result = validateCandidateFindings(
    candidateFindings({
      extraEnvelopeMetadata: "ignored",
      findings: [
        candidateFinding({
          priority: "must",
          traceability: {
            ...lineRangeTraceability(21, 22),
            extraAnchorHint: "ignored"
          },
          extraFindingMetadata: {
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

test("validateCandidateFindingsWithReport normalizes safe small-model formatting drift", () => {
  const payload = candidateFindings({
    findings: [
      candidateFinding({
        traceability: {
          kind: "line-range",
          lineStart: "21",
          lineEnd: "22"
        }
      })
    ]
  });

  const result = validateCandidateFindings(payload);

  assert.deepEqual(result.payload.findings[0]?.traceability, {
    kind: "line-range",
    lineStart: 21,
    lineEnd: 22
  });
  assert.deepEqual(result.payload.criticalMissingInformation, []);
});

test("validateCandidateFindingsWithReport rejects schema and ReviewBasis semantic violations", () => {
  const invalidCases: readonly {
    readonly label: string;
    readonly payload: Record<string, unknown>;
    readonly reason: RegExp;
  }[] = [
    {
      label: "invalid classification",
      payload: candidateFindings({
        findings: [candidateFinding({ classification: "unsupported_bug" })]
      }),
      reason: /classification.*confirmed_problem.*reasonable_risk/u
    },
    {
      label: "invalid severity",
      payload: candidateFindings({
        findings: [candidateFinding({ severity: "medium" })]
      }),
      reason: /severity.*high.*low/u
    },
    {
      label: "confirmed problem requires trigger condition",
      payload: candidateFindings({
        findings: [candidateFinding({ triggerCondition: "" })]
      }),
      reason: /triggerCondition/u
    },
    {
      label: "confirmed problem requires impact",
      payload: candidateFindings({
        findings: [candidateFinding({ impact: "" })]
      }),
      reason: /impact/u
    },
    {
      label: "confirmed problem requires counter-evidence",
      payload: candidateFindings({
        findings: [candidateFinding({ counterEvidence: [] })]
      }),
      reason: /counterEvidence/u
    },
    {
      label: "confirmed problem requires evidence",
      payload: candidateFindings({
        findings: [candidateFinding({ evidence: "" })]
      }),
      reason: /evidence/u
    },
    {
      label: "hypothesis closure must cover every ReviewBasis hypothesis",
      payload: candidateFindings({
        hypothesisClosure: [hypothesisClosure({ hypothesisId: "H1" })]
      }),
      reason: /H2.*hypothesisClosure/u
    },
    {
      label: "hypothesis closure must not duplicate a ReviewBasis hypothesis",
      payload: candidateFindings({
        hypothesisClosure: [
          hypothesisClosure({ hypothesisId: "H1" }),
          hypothesisClosure({
            hypothesisId: "H1",
            status: "rejected_by_evidence",
            rationale: "duplicate H1 closure"
          }),
          hypothesisClosure({
            hypothesisId: "H2",
            status: "rejected_by_evidence",
            rationale: "fallback still handles the changed path"
          })
        ]
      }),
      reason: /H1.*more than once.*hypothesisClosure/u
    },
    {
      label: "criticalMissingInformation must remain explicit",
      payload: (() => {
        const payload = candidateFindings();
        delete payload.criticalMissingInformation;
        return payload;
      })(),
      reason: /criticalMissingInformation.*array/u
    },
    {
      label: "insufficient closures must preserve blocking missing information",
      payload: candidateFindings({
        findings: [],
        findingOrigins: [],
        hypothesisClosure: [
          hypothesisClosure({
            hypothesisId: "H1",
            status: "insufficient_information",
            rationale: "missing contract blocks validation"
          }),
          hypothesisClosure({
            hypothesisId: "H2",
            status: "rejected_by_evidence",
            rationale: "fallback still handles the changed path"
          })
        ],
        criticalMissingInformation: []
      }),
      reason: /insufficient_information.*criticalMissingInformation/u
    },
    {
      label: "critical missing information requires insufficient closure",
      payload: candidateFindings({
        findings: [],
        findingOrigins: [],
        hypothesisClosure: [
          hypothesisClosure({
            hypothesisId: "H1",
            status: "rejected_by_evidence",
            rationale: "H1 rejected by reviewed evidence"
          }),
          hypothesisClosure({
            hypothesisId: "H2",
            status: "rejected_by_evidence",
            rationale: "fallback no longer closes the nullable-input path"
          })
        ],
        criticalMissingInformation: [
          missingInformationItem()
        ]
      }),
      reason: /criticalMissingInformation.*insufficient_information/u
    }
  ];

  for (const testCase of invalidCases) {
    const error = captureStructuredValidationReportError(
      () => validateCandidateFindings(testCase.payload)
    );

    assert.match(reportReasons(error), testCase.reason, testCase.label);
  }
});

test("validateCandidateFindingsWithReport allows findings with separate blocking missing information", () => {
  const result = validateCandidateFindings(
    candidateFindings({
      hypothesisClosure: [
        hypothesisClosure(),
        hypothesisClosure({
          hypothesisId: "H2",
          status: "insufficient_information",
          rationale: "H2 still needs an external contract"
        })
      ],
      criticalMissingInformation: [
        missingInformationItem()
      ]
    })
  );

  assert.equal(result.payload.result, "FINDINGS_READY");
  assert.equal(result.payload.findings.length, 1);
  assert.equal(result.payload.criticalMissingInformation.length, 1);
});

test("validateCandidateFindingsWithReport rejects invalid finding provenance", () => {
  const invalidCases: readonly {
    readonly label: string;
    readonly payload: Record<string, unknown>;
    readonly reason: RegExp;
  }[] = [
    {
      label: "findingOrigins must be explicit",
      payload: (() => {
        const payload = candidateFindings();
        delete payload.findingOrigins;
        return payload;
      })(),
      reason: /findingOrigins.*array/u
    },
    {
      label: "each finding needs an origin",
      payload: candidateFindings({
        findings: [
          candidateFinding(),
          candidateFinding({ title: "second candidate" })
        ],
        findingOrigins: [hypothesisFindingOrigin()]
      }),
      reason: /findingOrigins.*2|findingIndex.*2/u
    },
    {
      label: "finding origins cannot duplicate a finding index",
      payload: candidateFindings({
        findingOrigins: [
          hypothesisFindingOrigin(),
          supplementalFindingOrigin({
            lens: "data_flow_sweep",
            rationale: "duplicate origin for the same candidate"
          })
        ]
      }),
      reason: /findingIndex.*1.*more than once|duplicate.*findingIndex/u
    },
    {
      label: "findingIndex must reference an emitted finding",
      payload: candidateFindings({
        findingOrigins: [
          hypothesisFindingOrigin({ findingIndex: 2 })
        ]
      }),
      reason: /findingIndex.*2|out of range/u
    },
    {
      label: "hypothesis origins cannot reference unknown hypotheses",
      payload: candidateFindings({
        findingOrigins: [
          hypothesisFindingOrigin({ hypothesisIds: ["H404"] })
        ]
      }),
      reason: /H404.*hypothesisId|unknown.*H404/u
    },
    {
      label: "hypothesis origins require closed_by_candidate closure",
      payload: candidateFindings({
        findingOrigins: [hypothesisFindingOrigin()],
        hypothesisClosure: [
          hypothesisClosure({
            hypothesisId: "H1",
            status: "rejected_by_evidence",
            rationale: "H1 rejected by reviewed evidence"
          }),
          hypothesisClosure({
            hypothesisId: "H2",
            status: "rejected_by_evidence",
            rationale: "fallback no longer closes the nullable-input path"
          })
        ]
      }),
      reason: /H1.*closed_by_candidate|closed_by_candidate.*H1/u
    },
    {
      label: "closed_by_candidate closures require a hypothesis origin",
      payload: candidateFindings({
        findingOrigins: [
          supplementalFindingOrigin({
            relatedHypothesisIds: ["H1"]
          })
        ]
      }),
      reason: /H1.*findingOrigins|closed_by_candidate.*origin/u
    },
    {
      label: "supplemental origins require a known lens",
      payload: candidateFindings({
        findingOrigins: [
          supplementalFindingOrigin({
            lens: "repo_wide_guessing"
          })
        ],
        hypothesisClosure: [
          hypothesisClosure({
            hypothesisId: "H1",
            status: "rejected_by_evidence",
            rationale: "H1 rejected by reviewed evidence"
          }),
          hypothesisClosure({
            hypothesisId: "H2",
            status: "rejected_by_evidence",
            rationale: "fallback no longer closes the nullable-input path"
          })
        ]
      }),
      reason: /lens.*changed_behavior_sweep|repo_wide_guessing/u
    },
    {
      label: "supplemental origins must reference ReviewBasis evidence",
      payload: candidateFindings({
        findingOrigins: [
          supplementalFindingOrigin({
            evidenceIds: ["E404"]
          })
        ],
        hypothesisClosure: [
          hypothesisClosure({
            hypothesisId: "H1",
            status: "rejected_by_evidence",
            rationale: "H1 rejected by reviewed evidence"
          }),
          hypothesisClosure({
            hypothesisId: "H2",
            status: "rejected_by_evidence",
            rationale: "fallback no longer closes the nullable-input path"
          })
        ]
      }),
      reason: /E404.*evidenceId|unknown.*E404/u
    },
    {
      label: "supplemental findings are capped per file",
      payload: candidateFindings({
        findings: [
          candidateFinding({ title: "first supplemental" }),
          candidateFinding({ title: "second supplemental" }),
          candidateFinding({ title: "third supplemental" })
        ],
        findingOrigins: [
          supplementalFindingOrigin({ findingIndex: 1 }),
          supplementalFindingOrigin({
            findingIndex: 2,
            lens: "data_flow_sweep"
          }),
          supplementalFindingOrigin({
            findingIndex: 3,
            lens: "control_flow_sweep"
          })
        ],
        hypothesisClosure: [
          hypothesisClosure({
            hypothesisId: "H1",
            status: "rejected_by_evidence",
            rationale: "H1 rejected by reviewed evidence"
          }),
          hypothesisClosure({
            hypothesisId: "H2",
            status: "rejected_by_evidence",
            rationale: "fallback no longer closes the nullable-input path"
          })
        ]
      }),
      reason: /supplemental.*2|more than 2/u
    }
  ];

  for (const testCase of invalidCases) {
    const error = captureStructuredValidationReportError(
      () => validateCandidateFindings(testCase.payload)
    );

    assert.match(reportReasons(error), testCase.reason, testCase.label);
  }
});

test("validateCandidateFindingsWithReport rejects semantic reruns that introduce new candidate scope", () => {
  const previous = validateCandidateFindings().payload as CandidateFindings;
  const validRepair = validateCandidateFindings(
    candidateFindings(),
    createReviewBasis(),
    previous
  );
  assert.equal(validRepair.payload.findings[0]?.findingId, "F1");

  const changedHypothesisRepair = validateCandidateFindings(
    candidateFindings({
      findingOrigins: [
        hypothesisFindingOrigin({
          hypothesisIds: ["H2"]
        })
      ],
      hypothesisClosure: [
        hypothesisClosure({
          hypothesisId: "H1",
          status: "rejected_by_evidence",
          rationale: "H1 rejected during repair"
        }),
        hypothesisClosure({
          hypothesisId: "H2",
          status: "closed_by_candidate",
          rationale: "H2 now matches the corrected candidate evidence"
        })
      ]
    }),
    createReviewBasis(),
    previous
  );
  assert.deepEqual(changedHypothesisRepair.payload.findingOrigins[0]?.hypothesisIds, ["H2"]);

  const previousSupplemental = validateCandidateFindings(
    candidateFindings({
      findingOrigins: [
        supplementalFindingOrigin({
          rationale: "previous candidate came from a supplemental sweep"
        })
      ],
      hypothesisClosure: [
        hypothesisClosure({
          hypothesisId: "H1",
          status: "rejected_by_evidence",
          rationale: "H1 rejected by reviewed evidence"
        }),
        hypothesisClosure({
          hypothesisId: "H2",
          status: "rejected_by_evidence",
          rationale: "fallback no longer closes the nullable-input path"
        })
      ]
    })
  ).payload as CandidateFindings;
  const repairedSupplemental = validateCandidateFindings(
    candidateFindings({
      findingOrigins: [
        supplementalFindingOrigin({
          lens: "data_flow_sweep",
          relatedHypothesisIds: ["H1"],
          rationale: "repair preserves candidate count while correcting provenance metadata"
        })
      ],
      hypothesisClosure: [
        hypothesisClosure({
          hypothesisId: "H1",
          status: "rejected_by_evidence",
          rationale: "H1 rejected by reviewed evidence"
        }),
        hypothesisClosure({
          hypothesisId: "H2",
          status: "rejected_by_evidence",
          rationale: "fallback no longer closes the nullable-input path"
        })
      ]
    }),
    createReviewBasis(),
    previousSupplemental
  );
  assert.equal(repairedSupplemental.payload.findingOrigins[0]?.kind, "supplemental");
  assert.equal(repairedSupplemental.payload.findingOrigins[0]?.lens, "data_flow_sweep");

  const invalidCases: readonly {
    readonly label: string;
    readonly payload: Record<string, unknown>;
    readonly reason: RegExp;
  }[] = [
    {
      label: "semantic rerun cannot add candidate count",
      payload: candidateFindings({
        findings: [
          candidateFinding(),
          candidateFinding({ title: "new supplemental candidate" })
        ],
        findingOrigins: [
          hypothesisFindingOrigin(),
          supplementalFindingOrigin({
            findingIndex: 2,
            lens: "data_flow_sweep",
            rationale: "new candidate added on rerun"
          })
        ]
      }),
      reason: /semantic rerun.*more candidates/u
    },
    {
      label: "semantic rerun cannot introduce more supplemental candidates",
      payload: candidateFindings({
        findingOrigins: [
          supplementalFindingOrigin({
            rationale: "supplemental finding added during rerun"
          })
        ],
        hypothesisClosure: [
          hypothesisClosure({
            hypothesisId: "H1",
            status: "rejected_by_evidence",
            rationale: "H1 rejected by reviewed evidence"
          }),
          hypothesisClosure({
            hypothesisId: "H2",
            status: "rejected_by_evidence",
            rationale: "fallback no longer closes the nullable-input path"
          })
        ]
      }),
      reason: /semantic rerun.*more supplemental candidates/u
    }
  ];

  for (const testCase of invalidCases) {
    const error = captureStructuredValidationReportError(
      () => validateCandidateFindings(
        testCase.payload,
        createReviewBasis(),
        previous
      )
    );

    assert.match(reportReasons(error), testCase.reason, testCase.label);
  }
});

test("validateValidationReportV1WithReport accepts reports that approve only Candidate Findings candidates", () => {
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

test("validateValidationReportV1WithReport normalizes safe optional report metadata", () => {
  const payload = validationReportV1({
    perFindingResults: [
      {
        findingId: "F1",
        decision: "approve",
        failedGates: [],
        reason: "all semantic gates passed"
      }
    ],
    loopControl: {
      action: "accept"
    }
  });

  const result = validateValidationReport(
    payload
  );

  assert.deepEqual(result.payload.perFindingResults[0]?.failedGates, []);
  assert.deepEqual(result.payload.perFindingResults[0]?.requiredCorrections, []);
  assert.deepEqual(result.payload.missingInformationItems, []);
  assert.equal(result.payload.loopControl.reason, "semantic validation accepted");
});

test("validateValidationReportV1WithReport enforces candidate coverage and approved finding consistency", () => {
  const twoCandidates = candidateFindings({
    findings: [
      candidateFinding(),
      candidateFinding({
        title: "second finding"
      })
    ],
    findingOrigins: [
      hypothesisFindingOrigin(),
      supplementalFindingOrigin({
        findingIndex: 2,
        lens: "changed_behavior_sweep",
        rationale: "second candidate comes from a bounded changed behavior sweep"
      })
    ]
  });
  const findingsWithMissingInformation = candidateFindings({
    hypothesisClosure: [
      hypothesisClosure(),
      hypothesisClosure({
        hypothesisId: "H2",
        status: "insufficient_information",
        rationale: "H2 still needs an external contract"
      })
    ],
    criticalMissingInformation: [
      missingInformationItem()
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
      label: "perFindingResults cannot duplicate candidate entries",
      payload: validationReportV1({
        perFindingResults: [
          perFindingResult(),
          perFindingResult({
            findingId: "F1",
            decision: "drop",
            reason: "duplicate decision"
          })
        ]
      }),
      reason: /F1.*more than once/u
    },
    {
      label: "candidateFindings must be a valid payload",
      payload: validationReportV1(),
      candidates: { findings: "not-an-array" },
      reason: /findings.*array/u
    },
    {
      label: "critical missing information must surface in validation report",
      payload: validationReportV1(),
      candidates: findingsWithMissingInformation,
      reason: /criticalMissingInformation.*missingInformationItems/u
    },
    {
      label: "missingInformationItems must remain explicit",
      payload: (() => {
        const payload = validationReportV1();
        delete payload.missingInformationItems;
        return payload;
      })(),
      reason: /missingInformationItems.*array/u
    }
  ];

  for (const testCase of invalidCases) {
    const error = captureStructuredValidationReportError(
      () => validateValidationReport(
        testCase.payload,
        testCase.candidates ?? candidateFindings()
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
            requiredCorrections: "Prove concrete user impact or convert to missing information.",
            reason: "impact is asserted but not proven"
          })
        ],
        loopControl: {
          action: "rerun",
          reason: ""
        }
      })
    }
  ];

  for (const testCase of acceptedActions) {
    const result = validateValidationReport(testCase.payload);
    assert.equal(result.payload.loopControl.action, testCase.action);
    if (testCase.action === "rerun") {
      assert.deepEqual(result.payload.perFindingResults[0]?.failedGates, ["impact"]);
      assert.deepEqual(result.payload.perFindingResults[0]?.requiredCorrections, [
        "Prove concrete user impact or convert to missing information."
      ]);
      assert.equal(result.payload.loopControl.reason, "semantic rerun requested");
    }
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
          reason: "Candidate Findings must repair evidence gaps"
        }
      }),
      reason: /rerun.*approve findings/u
    },
    {
      label: "accept cannot leave rewrite-required candidates unresolved",
      payload: validationReportV1({
        perFindingResults: [
          perFindingResult({
            decision: "rewrite_required",
            failedGates: ["impact"],
            requiredCorrections: [
              "Prove concrete user impact before approval."
            ],
            reason: "impact is asserted but not proven"
          })
        ],
        loopControl: {
          action: "accept",
          reason: "incorrectly accepted unresolved rewrite"
        }
      }),
      reason: /accept.*rewrite_required/u
    },
    {
      label: "rewrite-required needs an actionable correction",
      payload: validationReportV1({
        perFindingResults: [
          perFindingResult({
            decision: "rewrite_required",
            failedGates: ["impact"],
            requiredCorrections: [],
            reason: "impact is asserted but not proven"
          })
        ],
        loopControl: {
          action: "rerun",
          reason: "candidate payload must repair evidence gaps"
        }
      }),
      reason: /rewrite_required.*requiredCorrection/u
    },
    {
      label: "failedGates must remain explicit",
      payload: validationReportV1({
        perFindingResults: [
          {
            findingId: "F1",
            decision: "approve",
            requiredCorrections: [],
            reason: "all semantic gates passed"
          }
        ]
      }),
      reason: /failedGates.*array/u
    },
    {
      label: "failedGates must use known semantic gate IDs",
      payload: validationReportV1({
        perFindingResults: [
          perFindingResult({
            decision: "rewrite_required",
            failedGates: ["unsupported_gate"],
            requiredCorrections: [
              "Prove concrete user impact before approval."
            ],
            reason: "impact is asserted but not proven"
          })
        ],
        loopControl: {
          action: "rerun",
          reason: "candidate payload must repair evidence gaps"
        }
      }),
      reason: /failedGates\[0\].*evidence.*impact.*traceability.*completeness.*scope/u
    }
  ];

  for (const testCase of invalidCases) {
    const error = captureStructuredValidationReportError(
      () => validateValidationReport(testCase.payload)
    );

    assert.match(reportReasons(error), testCase.reason, testCase.label);
  }
});
