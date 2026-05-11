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
        stepId: "candidate-findings",
        findingId: "F1",
        taxonomy: "OK",
        outcome: "accepted",
        gate: "schema"
      },
      {
        stepId: "candidate-findings",
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
        stepId: "semantic-validation",
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
      changedTests: ["test/core/step-resolve-helpers.test.ts"],
      observedCoverageSignals: ["resolver tests"],
      coverageGaps: []
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
        location: "src/app.ts:1",
        summary: "review basis state added"
      }
    ]
  };
}

function createCandidateFindingsV3() {
  return {
    findings: [
      {
        findingId: "F1",
        classification: "confirmed_problem",
        severity: "high",
        title: "guard moved after dereference",
        traceability: { kind: "line-range" as const, lineStart: 1, lineEnd: 1 },
        evidence: "changed branch reads value before fallback; guard runs after dereference",
        triggerCondition: "nullable input reaches the changed branch",
        impact: "request fails before fallback can run",
        counterEvidence: ["fallback no longer precedes dereference"]
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

function createValidationReportV1() {
  return {
    perFindingResults: [
      {
        findingId: "F1",
        decision: "approve",
        failedGates: [],
        requiredCorrections: [],
        reason: "all gates passed"
      }
    ],
    missingInformationItems: [
      {
        description: "Need the external null-input contract.",
        whyItMatters: "Without it the validator cannot prove expected behavior."
      }
    ],
    loopControl: { action: "accept", reason: "all gates passed" }
  };
}
