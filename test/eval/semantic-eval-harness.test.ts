import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { renderRunManifest } from "../../src/core/finalizers/run-manifest-finalizer.ts";
import type { ReviewBasisV1 } from "../../src/core/review-basis.ts";
import { StructuredOutputValidator, StructuredValidationReportError } from "../../src/core/structured-output-validator.ts";
import {
  createCoverageBuckets,
  createPlannedNotesFromPaths,
  createResolvedOutcomes,
  createSuccessfulFile
} from "../helpers/completed-run-finalizer-contract-fixture.ts";

type SemanticScenario =
  | "overclaim"
  | "retired-contradiction"
  | "identifier-mismatch"
  | "coverage-ambiguity"
  | "unclosed-hypothesis"
  | "repeated-stop";

interface SemanticCorpusCase {
  caseId: string;
  caseType: string;
  scenario: SemanticScenario;
  description: string;
  expected: {
    approvedFindingIds?: string[];
    candidateRejected?: boolean;
    decision?: string;
    taxonomy?: string;
    mustNotApproveHighSeverityConfirmedProblem?: boolean;
    coverage?: Record<string, number>;
  };
}

test("semantic eval corpus covers Phase 3 KKBOX-derived release gates", () => {
  const corpus = loadSemanticCorpus();
  assert.deepEqual(
    new Set(corpus.map((item) => item.scenario)),
    new Set<SemanticScenario>([
      "overclaim",
      "retired-contradiction",
      "identifier-mismatch",
      "coverage-ambiguity",
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
  if (corpusCase.scenario === "coverage-ambiguity") {
    const plannedNotes = createPlannedNotesFromPaths(["src/a.ts", "src/b.ts"]);
    const rendered = renderRunManifest({
      repoRoot: "/workspace/repo",
      baseRef: "main",
      headRef: "feature",
      outputTarget: {
        basePath: "/workspace/.nightowl/review/feature_03131430",
        changesetOverviewPath: "/workspace/.nightowl/review/feature_03131430/changeset-overview.md",
        filesPath: "/workspace/.nightowl/review/feature_03131430/files",
        summaryPath: "/workspace/.nightowl/review/feature_03131430/summary.md",
        indexPath: "/workspace/.nightowl/review/feature_03131430/index.md",
        skippedPath: "/workspace/.nightowl/review/feature_03131430/skipped.md",
        verifierReportPath: "/workspace/.nightowl/review/feature_03131430/verifier-report.jsonl",
        manifestPath: "/workspace/.nightowl/review/feature_03131430/manifest.json",
        toolAuditPath: "/workspace/.nightowl/review/feature_03131430/tool-audit.jsonl"
      },
      plannedNotes,
      resolvedOutcomes: createResolvedOutcomes(
        plannedNotes,
        [
          createSuccessfulFile("src/a.ts", []),
          createSuccessfulFile("src/b.ts", [])
        ],
        []
      ),
      coverage: createCoverageBuckets({
        totalChangedPaths: 5,
        reviewableNonDeletedPaths: 4,
        plannedReviewableNotePaths: 2,
        deletedPaths: 1,
        binaryOrNonReviewablePaths: 2,
        successfulPlannedFiles: 2,
        skippedPlannedFiles: 0,
        changedTests: []
      })
    } as Parameters<typeof renderRunManifest>[0]);
    const parsed = JSON.parse(rendered) as {
      coverage: Record<string, number>;
    };
    return {
      coverage: {
        totalChangedPaths: parsed.coverage.totalChangedPaths,
        plannedReviewableNotePaths: parsed.coverage.plannedReviewableNotePaths,
        deletedPaths: parsed.coverage.deletedPaths,
        binaryOrNonReviewablePaths: parsed.coverage.binaryOrNonReviewablePaths,
        skippedPlannedFiles: parsed.coverage.skippedPlannedFiles
      }
    };
  }

  const validator = new StructuredOutputValidator();
  const reviewBasis = createReviewBasis();
  const candidatePayload = createCandidatePayload(corpusCase.scenario);

  let candidateResult: ReturnType<typeof validator.validateCandidateFindingsV3WithReport>;
  try {
    candidateResult = validator.validateCandidateFindingsV3WithReport({
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
    candidateFindings: candidateResult.payload,
    reviewBasis,
    diffContent: DEFAULT_DIFF,
    filePath: reviewBasis.filePath
  });

  const approvedFindingIds = validationResult.payload.approvedFindings.map(
    (finding) => finding.findingId
  );
  const firstDecision = validationResult.payload.perFindingResults[0]?.decision;
  const highSeverityApproved = validationResult.payload.approvedFindings.some(
    (finding) => finding.type === "must" && /high/i.test(finding.impact)
  );

  return {
    approvedFindingIds,
    ...(corpusCase.expected.decision === undefined || firstDecision === undefined
      ? {}
      : { decision: firstDecision }),
    ...(corpusCase.expected.mustNotApproveHighSeverityConfirmedProblem
      ? { mustNotApproveHighSeverityConfirmedProblem: !highSeverityApproved }
      : {})
  };
}

const DEFAULT_DIFF = [
  "@@ -20,3 +20,5 @@",
  " context",
  "+request.searchRequestId = currentRequestId",
  "+callback.onSearchResult(result)",
  " context"
].join("\n");

function createReviewBasis(): ReviewBasisV1 {
  return {
    filePath: "SearchFragment.kt",
    roleInChangeset: "Reviews search callback state propagation.",
    changedBehavior: [
      {
        before: "Search callback used previous request state.",
        after: "Search callback records searchRequestId before dispatch.",
        evidenceIds: ["E1"]
      }
    ],
    facts: [
      {
        statement: "The diff writes searchRequestId before callback dispatch.",
        evidenceIds: ["E1"]
      }
    ],
    inferences: [],
    dependencyMap: {
      upstreamCallers: ["SearchFragment"],
      downstreamConsumers: ["Search callback"],
      externalContracts: [],
      sharedStateOrSideEffects: ["searchRequestId"]
    },
    flowMap: {
      entryPoints: ["onSearchResult"],
      stateTransitions: ["searchRequestId updated"],
      asyncBoundaries: ["callback dispatch"],
      errorPaths: []
    },
    testCoverage: {
      changedTests: [],
      observedCoverageSignals: [],
      coverageGaps: ["No callback-threading proof."]
    },
    identifierRegistry: {
      files: ["SearchFragment.kt"],
      symbols: ["searchRequestId", "onSearchResult"],
      resourceKeys: [],
      apiNames: ["onSearchResult"],
      stateNames: ["searchRequestId"]
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
        location: "SearchFragment.kt:21",
        summary: "searchRequestId is updated before callback dispatch"
      },
      {
        evidenceId: "E2",
        sourceType: "file",
        location: "SearchFragment.kt:24",
        summary: "callback dispatch happens after state update"
      }
    ]
  };
}

function createCandidatePayload(scenario: SemanticScenario) {
  return {
    findings: [
      {
        classification: "confirmed_problem",
        severity: "high",
        title: "searchRequestId concurrency overclaim",
        traceability: { kind: "line-range", lineStart: 21, lineEnd: 22 },
        evidence: "searchRequestId changes before callback at SearchFragment.kt:21",
        triggerCondition: "two search callbacks complete out of order",
        impact: "high severity search result corruption is alleged",
        counterEvidence: ["request ID guard not proven"]
      }
    ],
    hypothesisClosure:
      scenario === "identifier-mismatch"
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
              {
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
    approvedFindings: [],
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
    approvedFindings: [],
    missingInformationItems: [
      {
        description: "Need callback threading and stale-result guard proof.",
        whyItMatters: "Without it the concurrency claim is under-proven."
      }
    ],
    loopControl: { action: "accept", reason: "dropped with missing information" }
  };
}
