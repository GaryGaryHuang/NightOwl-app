import assert from "node:assert/strict";
import test from "node:test";

import { FileReviewContext, type Finding } from "../../../src/core/file-review-context.ts";
import type { ReviewBasisV1 } from "../../../src/core/review-basis.ts";
import { ReviewStatePromptSerializer } from "../../../src/core/review-state-prompt-serializer.ts";
import { Step5ValidationInterrogationStep } from "../../../src/core/steps/step5-validation-interrogation.ts";
import { Step6CognitiveSimulationStep } from "../../../src/core/steps/step6-cognitive-simulation.ts";

function createContext(findings: Finding[] = []): FileReviewContext {
  const context = new FileReviewContext({
    filePath: "src/app.ts",
    noteFilePath: "/tmp/src__app.ts.md",
    diffContent: "@@ -1 +1 @@\n-old\n+new\n",
    baseRef: "main",
    headRef: "feature"
  });

  context.setSection("strategy-what-if-scenarios", "## Strategy & What-if Scenarios\nW1: hypothesis");
  context.setReviewBasis(createReviewBasis());
  if (findings.length > 0) {
    context.setFindings(findings);
  }

  return context;
}

const serializer = new ReviewStatePromptSerializer();

function parseReviewStateFromPrompt(prompt: string): unknown {
  const match = prompt.match(
    /<review_state format="json">\n([\s\S]*?)\n<\/review_state>/u
  );
  assert.ok(match, "review_state JSON block should be present");
  return JSON.parse(match[1]);
}

test("Step5ValidationInterrogationStep prompt contract requests structured finding fields", () => {
  const step = new Step5ValidationInterrogationStep({ promptSerializer: serializer });
  const plan = step.prepare(createContext());

  assert.equal(plan.reviewProfile.timeoutMs, 300_000);
  assert.match(plan.prompt.systemMessage, /ReviewBasisV1\.hypothesisLedger/u);
  assert.match(plan.prompt.systemMessage, /CandidateFindingsV3/u);
  assert.match(plan.prompt.systemMessage, /final approved findings/u);
  assert.match(plan.prompt.userMessage, /<review_basis format="json">/u);
  assert.match(plan.prompt.userMessage, /hypothesisLedger/u);
  assert.match(plan.prompt.systemMessage, /Code Locations & Inline Anchors/u);
  assert.match(plan.prompt.systemMessage, /smallest head-side line range/u);
  assert.match(plan.prompt.systemMessage, /changedHeadLines/u);
  assert.match(plan.prompt.systemMessage, /classification/u);
  assert.match(plan.prompt.systemMessage, /evidenceStrength/u);
  assert.match(plan.prompt.systemMessage, /counterEvidenceChecked/u);
  assert.doesNotMatch(plan.prompt.systemMessage, /unless it is explicitly needed/u);
  assert.match(plan.prompt.userMessage, /"schemaVersion": 3/u);
  assert.match(plan.prompt.userMessage, /sourceHypothesisIds/u);
  assert.match(plan.prompt.userMessage, /hypothesisClosure/u);
  assert.match(plan.prompt.userMessage, /criticalMissingInformation/u);
  assert.doesNotMatch(plan.prompt.userMessage, /"schemaVersion": 2/u);
  assert.doesNotMatch(plan.prompt.userMessage, /"sourceHypothesisId"/u);
});

test("Step5ValidationInterrogationStep fails before prompt construction without ReviewBasis", () => {
  const context = new FileReviewContext({
    filePath: "src/app.ts",
    noteFilePath: "/tmp/src__app.ts.md",
    diffContent: "@@ -1 +1 @@\n-old\n+new\n",
    baseRef: "main",
    headRef: "feature"
  });
  const step = new Step5ValidationInterrogationStep({ promptSerializer: serializer });

  assert.throws(
    () => step.prepare(context),
    /ReviewBasis must exist before Step 5/u
  );
});

function createReviewBasis(): ReviewBasisV1 {
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
      changedTests: [],
      observedCoverageSignals: [],
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
        whyRelevantHere: "Phase 1 adds evidence refs.",
        closureCriteria: ["Every cited evidence ID exists."]
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

test("Step6CognitiveSimulationStep validates CandidateFindingsV3 and requests ValidationReportV1", () => {
  const candidatePayload = createCandidateFindingsV3();
  const step = new Step6CognitiveSimulationStep({ promptSerializer: serializer });
  const context = createContext() as SemanticFileReviewContext;
  context.setCandidateFindingsV3(candidatePayload);
  const plan = step.prepare(context);

  assert.equal(plan.reviewProfile.timeoutMs, 300_000);
  const snapshot = parseReviewStateFromPrompt(plan.prompt.userMessage) as {
    candidateFindings: ReturnType<typeof createCandidateFindingsV3>["findings"];
    verifiedFindings: Finding[];
  };

  assert.deepEqual(snapshot.candidateFindings, candidatePayload.findings);
  assert.deepEqual(snapshot.verifiedFindings, []);
  assert.equal(plan.prompt.userMessage.includes("<candidate_findings"), false);
  assert.match(plan.prompt.systemMessage, /Semantic Validation/u);
  assert.match(plan.prompt.systemMessage, /ValidationReportV1/u);
  assert.match(plan.prompt.systemMessage, /not a bug hunt/u);
  assert.match(plan.prompt.systemMessage, /Do not introduce new defects/u);
  assert.doesNotMatch(plan.prompt.systemMessage, /unless it is explicitly needed/u);
  assert.match(plan.prompt.userMessage, /perFindingResults/u);
  assert.match(plan.prompt.userMessage, /approvedFindings/u);
  assert.match(plan.prompt.userMessage, /missingInformationItems/u);
  assert.match(plan.prompt.userMessage, /loopControl/u);
  assert.match(plan.prompt.userMessage, /rerun_step5/u);
  assert.doesNotMatch(plan.prompt.userMessage, /findingUpdates/u);
  assert.doesNotMatch(plan.prompt.userMessage, /dispositions/u);
});

type SemanticFileReviewContext = FileReviewContext & {
  setCandidateFindingsV3(payload: ReturnType<typeof createCandidateFindingsV3>): void;
};

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
