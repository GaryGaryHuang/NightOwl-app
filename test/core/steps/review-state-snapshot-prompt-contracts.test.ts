import assert from "node:assert/strict";
import test from "node:test";

import type { ChangeMapReadinessV2 } from "../../../src/core/change-map.ts";
import { FileReviewContext, type Finding } from "../../../src/core/file-review-context.ts";
import type { ReviewBasisV1 } from "../../../src/core/review-basis.ts";
import { REVIEW_TURN_TIMEOUT_MS } from "../../../src/core/review-runtime-contract.ts";
import {
  ReviewStatePromptSerializer,
  type ReviewStateSnapshot
} from "../../../src/core/review-state-prompt-serializer.ts";
import { createRunContext } from "../../../src/core/run-context.ts";
import type {
  CandidateFindingsV3,
  ValidationReportV1
} from "../../../src/core/semantic-review.ts";
import { Step5ValidationInterrogationStep } from "../../../src/core/steps/step5-validation-interrogation.ts";
import { Step6CognitiveSimulationStep } from "../../../src/core/steps/step6-cognitive-simulation.ts";
import { Step7SummaryStep } from "../../../src/core/steps/step7-summary.ts";
import { ReviewBasisStep } from "../../../src/core/steps/review-basis-step.ts";
import { buildDefaultPerFileSteps } from "../../../src/core/orchestrator.ts";

const serializer = new ReviewStatePromptSerializer();

function createContext(): FileReviewContext {
  const context = new FileReviewContext({
    filePath: "src/app.ts",
    noteFilePath: "/tmp/src__app.ts.md",
    diffContent: "@@ -1 +1 @@\n-old\n+new\n",
    baseRef: "main",
    headRef: "feature"
  });

  context.setReviewBasis(createReviewBasis());

  return context;
}

function createFinding(findingId: string): Finding {
  return {
    findingId,
    classification: "confirmed_problem",
    severity: "high",
    title: `finding ${findingId}`,
    traceability: { kind: "line-range", lineStart: 1, lineEnd: 1 },
    evidence: "concrete evidence",
    triggerCondition: "trigger",
    impact: "impact",
    counterEvidence: ["checked"]
  };
}

function createCandidateFindings(): CandidateFindingsV3 {
  return {
    result: "FINDINGS_READY",
    findings: [
      {
        findingId: "F1",
        classification: "confirmed_problem",
        severity: "high",
        title: "candidate F1",
        traceability: { kind: "line-range", lineStart: 1, lineEnd: 1 },
        evidence: "review basis state added; candidate evidence is validated against ReviewBasis evidence refs",
        triggerCondition: "Step 5 cites absent evidence ID.",
        impact: "unsupported review findings would reach Step 7",
        counterEvidence: ["ReviewBasis evidenceRefs contains E1"]
      }
    ],
    hypothesisClosure: [
      {
        hypothesisId: "H1",
        status: "closed_by_candidate",
        rationale: "candidate F1 covers H1"
      }
    ],
    criticalMissingInformation: []
  };
}

function createValidationReport(findings: Finding[]): ValidationReportV1 {
  return {
    perFindingResults: findings.map((finding) => ({
      findingId: finding.findingId,
      decision: "approve",
      failedGates: [],
      requiredCorrections: [],
      reason: "semantic gates passed"
    })),
    missingInformationItems: [],
    loopControl: { action: "accept", reason: "semantic gates passed" }
  };
}

function createChangeMap(
  overviewMarkdown = "## Changeset Overview\n"
): ChangeMapReadinessV2 {
  return {
    reviewObjective: {
      summary: "Test review context.",
      requestedFocus: [],
      expectedBehaviorSummary: []
    },
    userContext: [],
    userBehavior: [],
    missingInformation: [],
    overviewMarkdown,
    behaviorChanges: [
      {
        description: "app changed",
        files: ["src/app.ts"]
      }
    ],
    unresolvedUnknowns: []
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
      changedTests: ["test/core/steps/review-state-snapshot-prompt-contracts.test.ts"],
      observedCoverageSignals: ["prompt snapshot tests"],
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

function parseReviewStateFromPrompt(prompt: string): ReviewStateSnapshot {
  const match = prompt.match(
    /<review_state format="json">\n([\s\S]*?)\n<\/review_state>/u
  );
  assert.ok(match, "review_state JSON block should be present");
  return JSON.parse(match[1]);
}

function assertBaseSnapshot(
  snapshot: ReviewStateSnapshot,
  options: { expectedSections?: Record<string, string>; expectEvidenceRefs?: boolean } = {
    expectedSections: {},
    expectEvidenceRefs: false
  }
): void {
  assert.equal(snapshot.filePath, "src/app.ts");
  assert.equal(snapshot.baseRef, "main");
  assert.equal(snapshot.headRef, "feature");
  assert.deepEqual(snapshot.diffSummary.hunks, [
    {
      hunkHeader: "@@ -1 +1 @@",
      headLineStart: 1,
      headLineEnd: 1,
      changedHeadLines: [1]
    }
  ]);
  assert.deepEqual(snapshot.sections, options.expectedSections ?? {});
  if (options.expectEvidenceRefs) {
    assert.equal(snapshot.evidenceRefs[0]?.evidenceId, "E1");
  } else {
    assert.deepEqual(snapshot.evidenceRefs, []);
  }
}

function assertDiffBlock(prompt: string): void {
  assert.match(
    prompt,
    /<diff path="src\/app\.ts" base="main" head="feature">/u
  );
  assert.match(prompt, /@@ -1 \+1 @@\n-old\n\+new/u);
  assert.match(prompt, /<\/diff>/u);
}

test("ReviewBasisStep prompt carries ChangeMapReadiness data, diff, and structured output contract", () => {
  const context = createContext();
  const runContext = createRunContext({
    changesetOverview: createChangeMap(
      "## Changeset Overview\n- Auth flow spans src/app.ts and package entrypoints."
    ),
    userContext: ["Root Cause: Step 5 context loss"]
  });

  const plan = new ReviewBasisStep({ runContext }).prepare(context);

  assert.equal(plan.stepId, "review-basis");
  assert.equal(plan.reviewProfile.knowledgeMode, "built-in-context7");
  assert.equal(plan.reviewProfile.model, "gpt-5.4-mini");
  assert.equal(plan.reviewProfile.timeoutMs, REVIEW_TURN_TIMEOUT_MS);
  assert.match(plan.prompt.systemMessage, /ReviewBasisV1/u);
  assert.doesNotMatch(plan.prompt.systemMessage, /\[假設\]|\[待確認\]/u);
  assert.match(plan.prompt.systemMessage, /structured field/u);
  assert.match(plan.prompt.userMessage, /<change_map format="json">/u);
  assert.match(plan.prompt.userMessage, /<diff path="src\/app\.ts"/u);
  assert.match(plan.prompt.userMessage, /identifierRegistry/u);
  assert.match(plan.prompt.userMessage, /hypothesisLedger/u);
  assert.match(plan.prompt.userMessage, /Do not produce findings/u);
});

test("default per-file pipeline starts with ReviewBasis and omits legacy Step 1-4", () => {
  const steps = buildDefaultPerFileSteps({
    runContext: createRunContext({
      changesetOverview: createChangeMap(),
      userContext: []
    }),
    renderReviewNote() {
      return "";
    },
    promptSerializer: serializer
  });

  assert.deepEqual(
    steps.map((step) => step.stepId),
    [
      "review-basis",
      "step5-validation-interrogation",
      "step6-cognitive-simulation",
      "step7-summary"
    ]
  );
});

test("Steps 5-7 receive parseable ReviewStateSnapshot JSON", () => {
  const context = createContext();
  const finding = createFinding("F1");
  context.setFindings([finding]);
  context.setCandidateFindingsV3(createCandidateFindings());
  context.setValidationReportV1(createValidationReport([finding]));
  context.setMissingInformationItems([]);

  const stepPlans = [
    new Step5ValidationInterrogationStep({ promptSerializer: serializer }).prepare(context),
    new Step6CognitiveSimulationStep({ promptSerializer: serializer }).prepare(context),
    new Step7SummaryStep({ promptSerializer: serializer }).prepare(context)
  ];

  const snapshots = stepPlans.map((plan) =>
    parseReviewStateFromPrompt(plan.prompt.userMessage)
  );

  assert.deepEqual(
    stepPlans.map((plan) => plan.reviewProfile.knowledgeMode),
    ["disabled", "disabled", "disabled"]
  );
  assert.deepEqual(
    stepPlans.map((plan) => plan.reviewProfile.timeoutMs),
    [REVIEW_TURN_TIMEOUT_MS, REVIEW_TURN_TIMEOUT_MS, REVIEW_TURN_TIMEOUT_MS]
  );

  snapshots.forEach((snapshot, index) => {
    assertBaseSnapshot(snapshot, {
      expectedSections: {},
      expectEvidenceRefs: index >= 0
    });
  });

  assert.equal(snapshots[1].candidateFindings?.result, "FINDINGS_READY");
  assert.equal(snapshots[1].candidateFindings?.findings[0]?.findingId, "F1");
  assert.equal(
    snapshots[1].candidateFindings?.hypothesisClosure[0]?.hypothesisId,
    "H1"
  );
  assert.deepEqual(
    snapshots[1].candidateFindings?.criticalMissingInformation,
    []
  );
  assert.deepEqual(snapshots[1].approvedFindings, []);
  assert.equal(
    snapshots[2].reviewBasis?.roleInChangeset,
    "Owns review prompt harness state handoff."
  );
  assert.deepEqual(snapshots[2].sections, {});
  assert.equal(snapshots[2].approvedFindings[0].findingId, "F1");
  assert.equal(snapshots[2].candidateFindings, null);
  assert.match(
    stepPlans[2].prompt.userMessage,
    /ReviewBasisV1\.roleInChangeset/u
  );
  assert.equal(stepPlans[1].prompt.userMessage.includes("<candidate_findings"), false);
});
