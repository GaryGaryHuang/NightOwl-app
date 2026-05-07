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
  const userMessage = plan.prompt.userMessage;
  assert.match(plan.prompt.systemMessage, /ReviewBasisV1/u);
  assert.match(plan.prompt.systemMessage, /Structured JSON Output/u);
  assert.match(plan.prompt.systemMessage, /JSON Completion/u);
  assert.match(plan.prompt.systemMessage, /Missing Information Discipline/u);
  assert.match(plan.prompt.systemMessage, /Do not record generic test gaps/u);
  assert.match(plan.prompt.systemMessage, /Keep the basis compact, selective, and high-signal/u);
  assert.match(plan.prompt.systemMessage, /Use only the provided `<change_map>`, `<diff>`, and local repository context/u);
  assert.match(plan.prompt.systemMessage, /Do not pre-emptively perform bug finding/u);
  assert.doesNotMatch(plan.prompt.systemMessage, /Code Locations & Inline Anchors/u);
  assert.match(userMessage, /<change_map format="json">/u);
  assert.match(userMessage, /<diff path="src\/app\.ts"/u);
  assert.match(userMessage, /Retrieve extra local repository context only when needed/u);
  assert.doesNotMatch(userMessage, /identifierRegistry/u);
  assert.match(userMessage, /hypothesisLedger/u);
  assert.match(userMessage, /Required output top-level fields/u);
  assert.match(userMessage, /`evidenceIds` reference `E\*` evidence IDs/u);
  assert.match(userMessage, /`hypothesisId` uses `H\*` IDs/u);
  assert.match(userMessage, /Keep changed behaviors, facts, inferences, and hypotheses compact/u);
  assert.match(userMessage, /include only high-signal entries needed for downstream finding generation/u);
  assert.doesNotMatch(userMessage, /Target 1-3 high-signal entries/u);
  assert.match(userMessage, /Keep `missingInformation` empty unless/u);
  assert.doesNotMatch(userMessage, /hypotheses, and missing-information items/u);
  assert.match(userMessage, /Evidence, ID, and entry rules/u);
  assert.doesNotMatch(userMessage, /Identifier and evidence rules/u);
  assert.match(userMessage, /distinct behavior change/u);
  assert.match(userMessage, /Define only `evidenceRefs\[\]` items referenced by high-signal/u);
  assert.match(userMessage, /do not define unused evidence refs/u);
  assert.doesNotMatch(userMessage, /Use at most 8 evidence refs/u);
  assert.match(userMessage, /Prefer consolidating related facts/u);
  assert.match(userMessage, /ReviewBasisV1 completion policy/u);
  assert.match(userMessage, /Prioritize a complete, valid JSON object/u);
  assert.match(userMessage, /Return compact JSON/u);
  assert.match(userMessage, /Empty arrays are valid for any array field/u);
  assert.match(userMessage, /Non-empty array item shapes/u);
  assert.match(userMessage, /`changedBehavior`: `\{ "before": "old behavior"/u);
  assert.match(userMessage, /`inferences`: `\{ "statement": "Bounded inference\."/u);
  assert.match(userMessage, /`evidenceRefs`: `\{ "evidenceId": "E1"/u);
  assert.match(userMessage, /Minimal valid shape example/u);
  assert.match(userMessage, /"changedBehavior": \[\]/u);
  assert.match(userMessage, /"evidenceRefs": \[\]/u);
  assert.match(userMessage, /keep each sub-field compact/u);
  assert.match(userMessage, /use an empty array when there is no direct high-signal information/u);
  assert.match(userMessage, /unless another distinct string is essential to a concrete hypothesis/u);
  assert.doesNotMatch(userMessage, /use at most one high-signal string per sub-field/u);
  assert.match(userMessage, /Every `evidenceIds`/u);

  const sectionOrder = [
    "Required output top-level fields:",
    "Non-empty array item shapes:",
    "Evidence, ID, and entry rules:",
    "ReviewBasisV1 completion policy:",
    "Minimal valid shape example:"
  ].map((section) => userMessage.indexOf(section));
  assert.ok(sectionOrder.every((index) => index >= 0));
  assert.ok(
    sectionOrder.every(
      (index, position) => position === 0 || sectionOrder[position - 1] < index
    )
  );
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
  assert.deepEqual(
    stepPlans.map((plan) => plan.reviewProfile.model),
    ["gpt-5.4-mini", "gpt-5.4-mini", "gpt-5.4-mini"]
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
    /prepared role and behavior-change evidence/u
  );
  assert.match(
    stepPlans[1].prompt.userMessage,
    /<candidate_ids>\n\["F1"\]\n<\/candidate_ids>/u
  );
  assert.equal(stepPlans[1].prompt.userMessage.includes("<candidate_findings"), false);
});
