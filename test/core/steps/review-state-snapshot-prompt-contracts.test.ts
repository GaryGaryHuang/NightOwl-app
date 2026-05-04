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
import { Step1OverviewStep } from "../../../src/core/steps/step1-overview.ts";
import { Step2DependenciesBoundariesStep } from "../../../src/core/steps/step2-dependencies-boundaries.ts";
import { Step3KnowledgeSourceOfTruthStep } from "../../../src/core/steps/step3-knowledge-source-of-truth.ts";
import {
  Step4StrategyWhatIfScenariosStep,
  type Step4FileCategoryMap
} from "../../../src/core/steps/step4-strategy-what-if-scenarios.ts";
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

  context.setSection("overview", "## Overview\nchanged old to new");
  context.setSection(
    "dependencies-boundaries",
    "## Dependencies & Boundaries\n- 相依清單：無外部相依\n- 隱含相依：無"
  );
  context.setSection(
    "knowledge-source-of-truth",
    "## Knowledge & Source of Truth\n- 版本／文件參考：無\n- 採用依據與必要假設：plain string value\n- 排除範圍：outside files"
  );
  context.setSection(
    "strategy-what-if-scenarios",
    "## Strategy & What-if Scenarios\n- What-if 假設情境：\n  - W1: value changes"
  );
  context.setReviewBasis(createReviewBasis());

  return context;
}

function createFinding(findingId: string): Finding {
  return {
    type: "must",
    title: `finding ${findingId}`,
    traceability: { kind: "line-range", lineStart: 1, lineEnd: 1 },
    expectedBehavior: "expected",
    actualBehavior: "actual",
    deviation: "dev",
    impact: "impact",
    suggestion: "suggestion",
    findingId,
    sourceHypothesisId: "W1"
  };
}

function createCandidateFindings(): CandidateFindingsV3 {
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
        title: "candidate F1",
        traceability: { kind: "line-range", lineStart: 1, lineEnd: 1 },
        codeEvidence: [
          {
            evidenceId: "E1",
            location: "src/app.ts:1",
            summary: "review basis state added"
          }
        ],
        executionPath: ["ReviewBasisStep.prepare", "Step5ValidationInterrogationStep.prepare"],
        triggerCondition: "Step 5 cites absent evidence ID.",
        failureMechanism: "candidate evidence is validated against ReviewBasis evidence refs",
        impact: "unsupported review findings would reach Step 7",
        counterEvidenceChecked: ["ReviewBasis evidenceRefs contains E1"],
        reproducibility: "deterministic in prompt snapshot construction",
        fixDirection: "reject absent evidence refs",
        testRecommendation: "keep prompt snapshot contract tests updated"
      }
    ],
    hypothesisClosure: [
      {
        hypothesisId: "H1",
        status: "closed_by_candidate",
        evidenceIds: ["E1"],
        rationale: "candidate F1 covers H1"
      }
    ],
    criticalMissingInformation: []
  };
}

function createValidationReport(findings: Finding[]): ValidationReportV1 {
  return {
    schemaVersion: 1,
    overallStatus: "PASS",
    perFindingResults: findings.map((finding) => ({
      findingId: finding.findingId,
      decision: "approve",
      failedGates: [],
      requiredCorrections: [],
      reason: "semantic gates passed"
    })),
    approvedFindings: findings.map((finding) => ({ ...finding })),
    missingInformationItems: [],
    loopControl: { action: "accept", reason: "semantic gates passed" }
  };
}

function createChangeMap(
  overviewMarkdown = "## Changeset Overview\n"
): ChangeMapReadinessV2 {
  return {
    schemaVersion: 2,
    reviewObjective: {
      summary: "Test review context.",
      requestedFocus: [],
      expectedBehaviorSummary: []
    },
    userContextSSOT: [],
    expectedBehaviorLedger: [],
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

function createStep4FileCategoryMap(): Step4FileCategoryMap {
  return {
    changedFiles: [
      {
        path: "src/app.ts",
        category: "feature"
      }
    ]
  };
}

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

function parseReviewStateFromPrompt(prompt: string): ReviewStateSnapshot {
  const match = prompt.match(
    /<review_state format="json">\n([\s\S]*?)\n<\/review_state>/u
  );
  assert.ok(match, "review_state JSON block should be present");
  return JSON.parse(match[1]);
}

function assertBaseSnapshot(
  snapshot: ReviewStateSnapshot,
  options: { expectSections?: boolean; expectEvidenceRefs?: boolean } = {
    expectSections: true,
    expectEvidenceRefs: false
  }
): void {
  assert.equal(snapshot.schemaVersion, 1);
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
  if (options.expectSections !== false) {
    assert.match(snapshot.sections.overview ?? "", /^## Overview/u);
  } else {
    assert.deepEqual(snapshot.sections, {
      overview: null,
      boundaryMap: null,
      sourcePack: null,
      hypothesisPack: null
    });
  }
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

test("Step1OverviewStep prompt carries changeset context, file diff, and profile metadata", () => {
  const context = createContext();
  const runContext = createRunContext({
    changesetOverview: createChangeMap(
      "## Changeset Overview\n- Auth flow spans src/app.ts and package entrypoints."
    ),
    userContext: ["PR describes a dry-run review workflow"]
  });

  const plan = new Step1OverviewStep({ runContext }).prepare(context);

  assert.equal(plan.stepId, "step1-overview");
  assert.equal(plan.reviewProfile.knowledgeMode, "disabled");
  assert.equal(plan.reviewProfile.model, "gpt-5.4-mini");
  assert.equal(plan.reviewProfile.timeoutMs, REVIEW_TURN_TIMEOUT_MS);
  assert.match(plan.prompt.systemMessage, /## Current Step: Overview/u);
  assert.match(plan.prompt.userMessage, /<changeset_context>/u);
  assert.match(plan.prompt.userMessage, /Auth flow spans src\/app\.ts/u);
  assertDiffBlock(plan.prompt.userMessage);
  assert.match(plan.prompt.userMessage, /測試覆蓋觀察/u);
});

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

test("Step2DependenciesBoundariesStep prompt carries Step 1 overview and boundary contract instructions", () => {
  const context = createContext();

  const plan = new Step2DependenciesBoundariesStep({
    promptSerializer: serializer
  }).prepare(context);
  const snapshot = parseReviewStateFromPrompt(plan.prompt.userMessage);

  assert.equal(plan.stepId, "step2-dependencies-boundaries");
  assert.equal(plan.reviewProfile.knowledgeMode, "disabled");
  assert.equal(plan.reviewProfile.model, "gpt-5.4-mini");
  assert.equal(plan.reviewProfile.timeoutMs, REVIEW_TURN_TIMEOUT_MS);
  assert.match(
    plan.prompt.systemMessage,
    /## Current Step: Dependencies & Boundaries/u
  );
  assert.equal(snapshot.sections.overview, "## Overview\nchanged old to new");
  assertDiffBlock(plan.prompt.userMessage);
  assert.match(plan.prompt.userMessage, /Contract/u);
  assert.match(plan.prompt.userMessage, /隱含相依/u);
  assert.match(plan.prompt.userMessage, /white-box/u);
  assert.match(plan.prompt.userMessage, /before marking uncertainty/u);
});

test("Step3KnowledgeSourceOfTruthStep prompt carries prior review state and knowledge-source instructions", () => {
  const context = createContext();

  const plan = new Step3KnowledgeSourceOfTruthStep({
    promptSerializer: serializer
  }).prepare(context);
  const snapshot = parseReviewStateFromPrompt(plan.prompt.userMessage);

  assert.equal(plan.stepId, "step3-knowledge-source-of-truth");
  assert.equal(plan.reviewProfile.knowledgeMode, "built-in-context7");
  assert.equal(plan.reviewProfile.model, "gpt-5.4-mini");
  assert.equal(plan.reviewProfile.timeoutMs, REVIEW_TURN_TIMEOUT_MS);
  assert.match(
    plan.prompt.systemMessage,
    /## Current Step: Knowledge & Source of Truth/u
  );
  assert.equal(snapshot.sections.overview, "## Overview\nchanged old to new");
  assert.match(
    snapshot.sections.boundaryMap ?? "",
    /## Dependencies & Boundaries/u
  );
  assertDiffBlock(plan.prompt.userMessage);
  assert.match(plan.prompt.userMessage, /版本／文件參考/u);
  assert.match(plan.prompt.userMessage, /採用依據與必要假設/u);
  assert.match(plan.prompt.userMessage, /必要假設：無/u);
  assert.match(plan.prompt.userMessage, /排除範圍/u);
});

test("Steps 2-7 receive parseable ReviewStateSnapshot JSON", () => {
  const context = createContext();
  const finding = createFinding("F1");
  context.setFindings([finding]);
  context.setCandidateFindingsV3(createCandidateFindings());
  context.setValidationReportV1(createValidationReport([finding]));
  context.setMissingInformationItems([]);

  const stepPlans = [
    new Step2DependenciesBoundariesStep({ promptSerializer: serializer }).prepare(context),
    new Step3KnowledgeSourceOfTruthStep({ promptSerializer: serializer }).prepare(context),
    new Step4StrategyWhatIfScenariosStep({
      promptSerializer: serializer,
      fileCategoryMap: createStep4FileCategoryMap()
    }).prepare(context),
    new Step5ValidationInterrogationStep({ promptSerializer: serializer }).prepare(context),
    new Step6CognitiveSimulationStep({ promptSerializer: serializer }).prepare(context),
    new Step7SummaryStep({ promptSerializer: serializer }).prepare(context)
  ];

  const snapshots = stepPlans.map((plan) =>
    parseReviewStateFromPrompt(plan.prompt.userMessage)
  );

  assert.deepEqual(
    stepPlans.map((plan) => plan.reviewProfile.knowledgeMode),
    [
      "disabled",
      "built-in-context7",
      "disabled",
      "disabled",
      "disabled",
      "disabled"
    ]
  );
  assert.deepEqual(
    stepPlans.map((plan) => plan.reviewProfile.timeoutMs),
    [
      REVIEW_TURN_TIMEOUT_MS,
      REVIEW_TURN_TIMEOUT_MS,
      REVIEW_TURN_TIMEOUT_MS,
      REVIEW_TURN_TIMEOUT_MS,
      REVIEW_TURN_TIMEOUT_MS,
      REVIEW_TURN_TIMEOUT_MS
    ]
  );

  snapshots.forEach((snapshot, index) => {
    assertBaseSnapshot(snapshot, {
      expectSections: index <= 2,
      expectEvidenceRefs: index >= 3
    });
  });

  assert.equal(snapshots[4].candidateFindings?.result, "FINDINGS_READY");
  assert.equal(snapshots[4].candidateFindings?.findings[0]?.findingId, "F1");
  assert.equal(
    snapshots[4].candidateFindings?.hypothesisClosure[0]?.hypothesisId,
    "H1"
  );
  assert.deepEqual(
    snapshots[4].candidateFindings?.criticalMissingInformation,
    []
  );
  assert.deepEqual(snapshots[4].verifiedFindings, []);
  assert.equal(
    snapshots[5].reviewBasis?.roleInChangeset,
    "Owns review prompt harness state handoff."
  );
  assert.deepEqual(snapshots[5].sections, {
    overview: null,
    boundaryMap: null,
    sourcePack: null,
    hypothesisPack: null
  });
  assert.equal(snapshots[5].verifiedFindings[0].findingId, "F1");
  assert.equal(snapshots[5].candidateFindings, null);
  assert.match(
    stepPlans[5].prompt.userMessage,
    /ReviewBasisV1\.roleInChangeset/u
  );
  assert.equal(stepPlans[4].prompt.userMessage.includes("<candidate_findings"), false);
});
