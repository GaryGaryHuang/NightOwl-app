import test from "node:test";
import assert from "node:assert/strict";

import { FileReviewContext } from "../../src/core/file-review-context.ts";
import {
  StructuredOutputValidator,
  StructuredValidationReportError
} from "../../src/core/structured-output-validator.ts";
import {
  createCandidateFindingsResolve,
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

test("createCandidateFindingsResolve stores candidate state without promoting approved findings", async () => {
  const context = createContext() as SemanticFileReviewContext;
  const candidatePayload = createCandidateFindings();
  const resolve = createCandidateFindingsResolve({
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
    context.getCandidateFindings()?.findings.map((candidate) => candidate.findingId),
    ["F1"]
  );
  assert.deepEqual(context.getCandidateFindings()?.findingOrigins, [
    {
      findingIndex: 1,
      kind: "hypothesis",
      hypothesisIds: ["H1"],
      evidenceIds: ["E1"],
      rationale: "candidate covers H1"
    }
  ]);
});

test("createCandidateFindingsResolve enforces prior candidate scope on semantic rerun", async () => {
  const reviewBasis = createReviewBasis();
  const previousCandidateFindings =
    new StructuredOutputValidator().validateCandidateFindingsWithReport({
      responseText: JSON.stringify(createCandidateFindings()),
      reviewBasis,
      diffContent: DEFAULT_CONTEXT.diffContent,
      filePath: DEFAULT_CONTEXT.filePath
    }).payload;
  const candidatePayload = createCandidateFindings();
  candidatePayload.findings = [
    candidatePayload.findings[0]!,
    {
      ...candidatePayload.findings[0]!,
      findingId: "F2",
      title: "new supplemental candidate"
    }
  ];
  candidatePayload.findingOrigins = [
    candidatePayload.findingOrigins[0]!,
    {
      findingIndex: 2,
      kind: "supplemental",
      lens: "changed_behavior_sweep",
      evidenceIds: ["E1"],
      rationale: "new supplemental candidate added during semantic rerun",
      relatedHypothesisIds: []
    }
  ];
  const resolve = createCandidateFindingsResolve({
    filePath: DEFAULT_CONTEXT.filePath,
    diffContent: DEFAULT_CONTEXT.diffContent,
    reviewBasis,
    previousCandidateFindings
  });

  await assert.rejects(
    () => resolve(JSON.stringify(candidatePayload), createResolveServices()),
    (error) => {
      assert.equal(error instanceof StructuredValidationReportError, true);
      const reportError = error as StructuredValidationReportError;
      assert.match(
        reportError.report.map((entry) => entry.reason ?? "").join("\n"),
        /semantic rerun.*more candidates/u
      );
      return true;
    }
  );
});

test("createValidationReportV1Resolve writes approved findings and missing-information state", async () => {
  const context = createContext() as SemanticFileReviewContext;
  const candidatePayload = createCandidateFindings();
  const validationReport = createValidationReportV1();
  context.setCandidateFindings(candidatePayload);
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
});

function createContext(): FileReviewContext {
  return new FileReviewContext({ ...DEFAULT_CONTEXT });
}

type SemanticFileReviewContext = FileReviewContext & {
  setCandidateFindings(payload: ReturnType<typeof createCandidateFindings>): void;
  getCandidateFindings(): ReturnType<typeof createCandidateFindings> | undefined;
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

function createCandidateFindings() {
  const findingOrigins: Array<Record<string, unknown>> = [
    {
      findingIndex: 1,
      kind: "hypothesis",
      hypothesisIds: ["H1"],
      evidenceIds: ["E1"],
      rationale: "candidate covers H1"
    }
  ];

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
    findingOrigins,
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
