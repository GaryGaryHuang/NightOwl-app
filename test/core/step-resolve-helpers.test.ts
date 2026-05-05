import test from "node:test";
import assert from "node:assert/strict";

import { FileReviewContext } from "../../src/core/file-review-context.ts";
import { StructuredOutputValidator } from "../../src/core/structured-output-validator.ts";
import {
  createCandidateFindingsV3Resolve,
  createValidationReportV1Resolve
} from "../../src/core/steps/step-resolve-helpers.ts";
import type { ReviewBasisV1 } from "../../src/core/review-basis.ts";
import type { StepResolveServices } from "../../src/core/step-runner.ts";

const DEFAULT_CONTEXT = {
  filePath: "src/app.ts",
  noteFilePath: "/tmp/src__app.ts.md",
  diffContent: "@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n",
  baseRef: "main",
  headRef: "feature"
} as const;

test("createCandidateFindingsV3Resolve stores candidate state without promoting approved findings", async () => {
  const context = createContext() as SemanticFileReviewContext;
  const candidatePayload = createCandidateFindingsV3();
  const resolve = createCandidateFindingsV3Resolve({
    filePath: DEFAULT_CONTEXT.filePath,
    diffContent: DEFAULT_CONTEXT.diffContent,
    reviewBasis: createReviewBasis()
  });

  const applyTo = await resolve(
    JSON.stringify(candidatePayload),
    createResolveServices()
  );

  applyTo(context);

  assert.equal(context.getFindings(), undefined);
  assert.deepEqual(
    context.getCandidateFindingsV3()?.findings.map((candidate) => candidate.findingId),
    ["F1"]
  );
  assert.deepEqual(
    context.getVerifierReportEntries()?.map((entry) => ({
      stepId: entry.stepId,
      findingId: entry.findingId,
      taxonomy: entry.taxonomy,
      outcome: entry.outcome,
      gate: entry.gate
    })),
    [
      {
        stepId: "step5-validation-interrogation",
        findingId: "F1",
        taxonomy: "OK",
        outcome: "accepted",
        gate: "schema"
      },
      {
        stepId: "step5-validation-interrogation",
        findingId: "F1",
        taxonomy: "OK",
        outcome: "accepted",
        gate: "semantic"
      }
    ]
  );
});

test("createValidationReportV1Resolve writes approved findings and missing-information state", async () => {
  const context = createContext() as SemanticFileReviewContext;
  const candidatePayload = createCandidateFindingsV3();
  const validationReport = createValidationReportV1();
  context.setCandidateFindingsV3(candidatePayload);
  const resolve = createValidationReportV1Resolve({
    filePath: DEFAULT_CONTEXT.filePath,
    diffContent: DEFAULT_CONTEXT.diffContent,
    reviewBasis: createReviewBasis(),
    candidatePayload
  });

  const applyTo = await resolve(
    JSON.stringify(validationReport),
    createResolveServices()
  );

  applyTo(context);

  assert.deepEqual(
    context.getFindings()?.map((finding) => finding.findingId),
    ["F1"]
  );
  assert.equal(context.getValidationReportV1()?.loopControl.action, "accept");
  assert.deepEqual(context.getMissingInformationItems(), [
    {
      itemId: "MI1",
      findingId: "F1",
      description: "Need the external null-input contract.",
      whyItMatters: "Without it the validator cannot prove expected behavior."
    }
  ]);
  assert.deepEqual(
    context.getVerifierReportEntries()?.map((entry) => ({
      stepId: entry.stepId,
      findingId: entry.findingId,
      taxonomy: entry.taxonomy,
      outcome: entry.outcome,
      gate: entry.gate
    })),
    [
      {
        stepId: "step6-cognitive-simulation",
        findingId: "F1",
        taxonomy: "OK",
        outcome: "accepted",
        gate: "schema"
      },
      {
        stepId: "step6-cognitive-simulation",
        findingId: "F1",
        taxonomy: "OK",
        outcome: "accepted",
        gate: "semantic"
      }
    ]
  );
});

function createContext(): FileReviewContext {
  return new FileReviewContext({ ...DEFAULT_CONTEXT });
}

type SemanticFileReviewContext = FileReviewContext & {
  setCandidateFindingsV3(payload: ReturnType<typeof createCandidateFindingsV3>): void;
  getCandidateFindingsV3(): ReturnType<typeof createCandidateFindingsV3> | undefined;
  setValidationReportV1(report: ReturnType<typeof createValidationReportV1>): void;
  getValidationReportV1(): ReturnType<typeof createValidationReportV1> | undefined;
  setMissingInformationItems(items: ReturnType<typeof createValidationReportV1>["missingInformationItems"]): void;
  getMissingInformationItems(): ReturnType<typeof createValidationReportV1>["missingInformationItems"] | undefined;
};

function createResolveServices(): StepResolveServices {
  return {
    validator: new StructuredOutputValidator()
  };
}

function createReviewBasis(): ReviewBasisV1 {
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
      changedTests: ["test/core/step-resolve-helpers.test.ts"],
      observedCoverageSignals: ["resolver tests"],
      coverageGaps: []
    },
    identifierRegistry: {
      files: ["src/app.ts"],
      symbols: ["ReviewBasisV1"],
      resourceKeys: [],
      apiNames: [],
      stateNames: ["reviewBasis"]
    },
    hypothesisLedger: [
      {
        hypothesisId: "H1",
        statement: "Evidence refs may be missing.",
        triggerCondition: "Step 5 cites absent evidence ID.",
      }
    ],
    missingInformation: [],
    evidenceRefs: [
      {
        evidenceId: "E1",
        sourceType: "diff",
        location: "src/app.ts:1",
        summary: "review basis state added"
      }
    ]
  };
}

function createCandidateFindingsV3() {
  return {
    schemaVersion: 3,
    result: "FINDINGS_READY",
    findings: [
      {
        findingId: "F1",
        sourceHypothesisIds: ["H1"],
        classification: "confirmed_problem",
        priority: "must",
        severity: "high",
        confidence: "high",
        evidenceStrength: "direct",
        title: "guard moved after dereference",
        traceability: { kind: "line-range" as const, lineStart: 1, lineEnd: 1 },
        codeEvidence: [
          {
            evidenceId: "E1",
            location: "src/app.ts:1",
            summary: "changed branch reads value before fallback"
          }
        ],
        executionPath: ["entry receives nullable input", "changed branch reads value"],
        triggerCondition: "nullable input reaches the changed branch",
        failureMechanism: "guard runs after dereference",
        impact: "request fails before fallback can run",
        counterEvidenceChecked: ["fallback no longer precedes dereference"],
        reproducibility: "deterministic with nullable input",
        fixDirection: "restore guard before dereference",
        testRecommendation: "add nullable input regression coverage"
      }
    ],
    hypothesisClosure: [
      {
        hypothesisId: "H1",
        status: "closed_by_candidate",
        evidenceIds: ["E1"],
        rationale: "F1 validates the hypothesis."
      }
    ],
    criticalMissingInformation: []
  };
}

function createValidationReportV1() {
  return {
    schemaVersion: 1,
    overallStatus: "PASS",
    perFindingResults: [
      {
        findingId: "F1",
        decision: "approve",
        failedGates: [],
        requiredCorrections: [],
        recommendedClassification: "confirmed_problem",
        recommendedPriority: "must",
        recommendedSeverity: "high",
        reason: "all gates passed"
      }
    ],
    approvedFindings: [
      {
        type: "must" as const,
        title: "guard moved after dereference",
        traceability: { kind: "line-range" as const, lineStart: 1, lineEnd: 1 },
        expectedBehavior: "nullable input returns fallback",
        actualBehavior: "changed branch reads value first",
        deviation: "fallback no longer runs before dereference",
        impact: "request fails before fallback can run",
        suggestion: "restore guard before dereference",
        findingId: "F1",
        sourceHypothesisId: "H1"
      }
    ],
    missingInformationItems: [
      {
        itemId: "MI1",
        findingId: "F1",
        description: "Need the external null-input contract.",
        whyItMatters: "Without it the validator cannot prove expected behavior."
      }
    ],
    loopControl: { action: "accept", reason: "all gates passed" }
  };
}
