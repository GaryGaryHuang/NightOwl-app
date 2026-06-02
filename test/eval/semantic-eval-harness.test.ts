import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import type { ReviewBasis } from "../../src/core/review-basis.ts";
import { StructuredOutputValidator, StructuredValidationReportError } from "../../src/core/structured-output-validator.ts";

type SemanticScenario =
  | "overclaim"
  | "retired-contradiction"
  | "hypothesis-id-mismatch"
  | "unclosed-hypothesis"
  | "repeated-stop";

interface SemanticCorpusCase {
  caseId: string;
  scenario: SemanticScenario;
  description: string;
  expected: {
    approvedFindingIds?: string[];
    candidateRejected?: boolean;
    decision?: string;
    taxonomy?: string;
    mustNotApproveMustFixPriority?: boolean;
  };
}

test("semantic eval corpus covers semantic review regression guardrails", () => {
  const corpus = loadSemanticCorpus();
  assert.deepEqual(
    new Set(corpus.map((item) => item.scenario)),
    new Set<SemanticScenario>([
      "overclaim",
      "retired-contradiction",
      "hypothesis-id-mismatch",
      "unclosed-hypothesis",
      "repeated-stop"
    ])
  );
});

for (const corpusCase of loadSemanticCorpus()) {
  test(`semantic eval ${corpusCase.caseId}`, () => {
    const result = runSemanticCase(corpusCase);
    assert.deepEqual(result, corpusCase.expected);
  });
}

function loadSemanticCorpus(): SemanticCorpusCase[] {
  const corpusPath = path.resolve(import.meta.dirname, "semantic-corpus.jsonl");
  return readFileSync(corpusPath, "utf-8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as SemanticCorpusCase);
}

function runSemanticCase(
  corpusCase: SemanticCorpusCase
): SemanticCorpusCase["expected"] {
  const validator = new StructuredOutputValidator();
  const reviewBasis = createReviewBasis();
  const candidatePayload = createCandidatePayload(corpusCase.scenario);

  let candidateValidationResult: ReturnType<typeof validator.validateCandidateFindingsWithReport>;
  try {
    candidateValidationResult = validator.validateCandidateFindingsWithReport({
      responseText: JSON.stringify(candidatePayload),
      reviewBasis,
      diffContent: DEFAULT_DIFF,
      filePath: reviewBasis.filePath
    });
  } catch (error) {
    assert.equal(error instanceof StructuredValidationReportError, true);
    const reportError = error as StructuredValidationReportError;
    return {
      candidateRejected: true,
      taxonomy: reportError.report.at(-1)?.taxonomy
    };
  }

  const validationPayload = createValidationReportPayload(corpusCase.scenario);
  const validationResult = validator.validateValidationReportV1WithReport({
    responseText: JSON.stringify(validationPayload),
    candidateFindings: candidateValidationResult.payload,
    reviewBasis,
    diffContent: DEFAULT_DIFF,
    filePath: reviewBasis.filePath
  });

  const approvedFindingIds = validationResult.payload.perFindingResults
    .filter((r: { decision: string }) => r.decision === "approve")
    .map((r: { findingId: string }) => r.findingId);
  const firstDecision = validationResult.payload.perFindingResults[0]?.decision;
  const candidateFindings = (candidateValidationResult.payload as { findings?: Array<{ findingId: string; priority: string }> }).findings ?? [];
  const mustFixApproved = approvedFindingIds.some(
    (id: string) => candidateFindings.some(
      (f) => f.findingId === id && f.priority === "must_fix"
    )
  );

  return {
    approvedFindingIds,
    ...(corpusCase.expected.decision === undefined || firstDecision === undefined
      ? {}
      : { decision: firstDecision }),
    ...(corpusCase.expected.mustNotApproveMustFixPriority
      ? { mustNotApproveMustFixPriority: !mustFixApproved }
      : {})
  };
}

const DEFAULT_DIFF = [
  "@@ -20,3 +20,5 @@",
  " context",
  "+request.requestToken = currentRequestToken",
  "+callback.onSearchResult(result)",
  " context"
].join("\n");

function createReviewBasis(): ReviewBasis {
  return {
    filePath: "AsyncResultController.kt",
    roleInChangeset: "Reviews search callback state propagation.",
    changedBehavior: [
      {
        before: "Search callback used previous request state.",
        after: "Search callback records requestToken before dispatch.",
        evidenceIds: ["E1"]
      }
    ],
    facts: [
      {
        statement: "The diff writes requestToken before callback dispatch.",
        evidenceIds: ["E1"]
      }
    ],
    inferences: [],
    dependencyMap: {
      upstreamCallers: ["AsyncResultController"],
      downstreamConsumers: ["Search callback"],
      externalContracts: [],
      sharedStateOrSideEffects: ["requestToken"]
    },
    flowMap: {
      entryPoints: ["onSearchResult"],
      stateTransitions: ["requestToken updated"],
      asyncBoundaries: ["callback dispatch"],
      errorPaths: []
    },
    hypothesisLedger: [
      {
        hypothesisId: "H1",
        statement: "The callback could apply a stale search result.",
        triggerCondition: "Two async search requests complete out of order.",
      },
      {
        hypothesisId: "H2",
        statement: "The changed path may already guard stale callbacks.",
        triggerCondition: "Callback compares request ID before UI mutation.",
      }
    ],
    missingInformation: [],
    evidenceRefs: [
      {
        evidenceId: "E1",
        sourceType: "diff",
        location: "AsyncResultController.kt:21",
        summary: "requestToken is updated before callback dispatch"
      },
      {
        evidenceId: "E2",
        sourceType: "file",
        location: "AsyncResultController.kt:24",
        summary: "callback dispatch happens after state update"
      }
    ]
  };
}

function createCandidatePayload(scenario: SemanticScenario) {
  return {
    findings: [
      {
        priority: "must_fix",
        title: "requestToken concurrency overclaim",
        traceability: { kind: "line-range", lineStart: 21, lineEnd: 22 },
        evidence: "requestToken changes before callback at AsyncResultController.kt:21",
        triggerCondition: "two search callbacks complete out of order",
        impact: "must-fix priority search result corruption is alleged",
        counterEvidence: ["request ID guard not proven"]
      }
    ],
    findingOrigins: [
      {
        findingIndex: 1,
        kind: "hypothesis",
        hypothesisIds: [
          scenario === "hypothesis-id-mismatch" ? "H404" : "H1"
        ],
        evidenceIds: ["E1"],
        rationale: "candidate addresses stale callback"
      }
    ],
    hypothesisClosure:
      scenario === "hypothesis-id-mismatch"
        ? [
            {
              hypothesisId: "H404",
              status: "closed_by_candidate",
              rationale: "candidate addresses stale callback"
            },
            {
              hypothesisId: "H2",
              status: "insufficient_information",
              rationale: "counter-evidence is not enough to approve"
            }
          ]
        : scenario === "unclosed-hypothesis"
          ? [
              {
                hypothesisId: "H1",
                status: "closed_by_candidate",
                rationale: "candidate addresses stale callback"
              }
            ]
          : [
              {
                hypothesisId: "H1",
                status: "closed_by_candidate",
                rationale: "candidate addresses stale callback"
              },
              scenario === "retired-contradiction"
                || scenario === "overclaim"
                || scenario === "repeated-stop"
                ? {
                    hypothesisId: "H2",
                    status: "rejected_by_evidence",
                    rationale: "counter-evidence contradicts the claimed stale-callback defect"
                  }
                : {
                    hypothesisId: "H2",
                    status: "insufficient_information",
                    rationale: "counter-evidence is not enough to approve"
                  }
            ],
    criticalMissingInformation: []
  };
}

function createValidationReportPayload(scenario: SemanticScenario) {
  if (scenario === "repeated-stop") {
    return dropReport();
  }

  if (scenario === "overclaim") {
    return dropReport();
  }

  return {
    perFindingResults: [
      {
        findingId: "F1",
        decision: "drop",
        failedGates: ["evidence"],
        requiredCorrections: ["Counter-evidence contradicts the claimed defect."],
        reason: "retired false-positive contradiction"
      }
    ],
    missingInformationItems: [],
    loopControl: { action: "accept", reason: "claim dropped" }
  };
}

function dropReport() {
  return {
    perFindingResults: [
      {
        findingId: "F1",
        decision: "drop",
        failedGates: ["completeness"],
        requiredCorrections: ["Prove callback threading, trigger, impact, and counter-evidence before approval."],
        reason: "approval is blocked by insufficient proof"
      }
    ],
    missingInformationItems: [
      {
        description: "Need callback threading and stale-result guard proof.",
        whyItMatters: "Without it the concurrency claim is under-proven."
      }
    ],
    loopControl: { action: "accept", reason: "dropped with missing information" }
  };
}
