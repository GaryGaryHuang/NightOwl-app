import assert from "node:assert/strict";
import test from "node:test";

import type { ChangeMapReadinessV2 } from "../../../src/core/change-map.ts";
import { FileReviewContext, type Finding } from "../../../src/core/file-review-context.ts";
import {
  REVIEW_BASIS_INFERENCE_CONFIDENCES,
  type ReviewBasisV1
} from "../../../src/core/review-basis.ts";
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
import { CandidateFindingsStep } from "../../../src/core/steps/candidate-findings-step.ts";
import { SemanticValidationStep } from "../../../src/core/steps/semantic-validation-step.ts";
import { ReviewSummaryStep } from "../../../src/core/steps/review-summary-step.ts";
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
        triggerCondition: "Candidate Findings cites absent evidence ID.",
        impact: "unsupported review findings would reach Review Summary",
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
      changedTests: ["test/core/steps/review-state-snapshot-prompt-contracts.test.ts"],
      observedCoverageSignals: ["prompt snapshot tests"],
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

function parseReviewStateFromPrompt(prompt: string): ReviewStateSnapshot {
  return parseJsonBlock(prompt, "review_state") as ReviewStateSnapshot;
}

function parseJsonBlock(prompt: string, blockName: string): unknown {
  const match = prompt.match(
    new RegExp(
      `<${blockName} format="json">\\n([\\s\\S]*?)\\n</${blockName}>`,
      "u"
    )
  );
  assert.ok(match, `${blockName} JSON block should be present`);
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

function assertReviewBasisOutputContract(prompt: string): void {
  for (const field of [
    "roleInChangeset",
    "changedBehavior",
    "before",
    "after",
    "evidenceIds",
    "facts",
    "statement",
    "inferences",
    "basedOnEvidenceIds",
    "confidence",
    "dependencyMap",
    "upstreamCallers",
    "downstreamConsumers",
    "externalContracts",
    "sharedStateOrSideEffects",
    "flowMap",
    "entryPoints",
    "stateTransitions",
    "asyncBoundaries",
    "errorPaths",
    "testCoverage",
    "changedTests",
    "observedCoverageSignals",
    "coverageGaps",
    "hypothesisLedger",
    "hypothesisId",
    "triggerCondition",
    "missingInformation",
    "description",
    "whyItMatters",
    "evidenceRefs",
    "evidenceId",
    "sourceType",
    "location",
    "summary"
  ]) {
    assert.match(prompt, new RegExp(field, "u"));
  }

  for (const confidence of REVIEW_BASIS_INFERENCE_CONFIDENCES) {
    assert.match(prompt, new RegExp(`\\b${confidence}\\b`, "u"));
  }
}

test("ReviewBasisStep wires ChangeMapReadiness data, diff, and ReviewBasis harness contract", () => {
  const context = createContext();
  const runContext = createRunContext({
    changesetOverview: createChangeMap(
      "## Changeset Overview\n- Auth flow spans src/app.ts and package entrypoints."
    ),
    userContext: ["Root Cause: Candidate Findings context loss"]
  });

  const plan = new ReviewBasisStep({ runContext }).prepare(context);

  assert.equal(plan.stepId, "review-basis");
  assert.equal(plan.reviewProfile.knowledgeMode, "built-in-context7");
  assert.equal(plan.reviewProfile.model, "gpt-5.4-mini");
  assert.equal(plan.reviewProfile.timeoutMs, REVIEW_TURN_TIMEOUT_MS);
  const userMessage = plan.prompt.userMessage;

  assert.deepEqual(parseJsonBlock(userMessage, "change_map"), runContext.changesetOverview);
  assertDiffBlock(userMessage);
  assert.equal(userMessage.includes("<review_state"), false);
  assert.equal(userMessage.includes("<review_basis"), false);
  assertReviewBasisOutputContract(userMessage);
});

test("default per-file pipeline is the four-step semantic pipeline", () => {
  const steps = buildDefaultPerFileSteps({
    runContext: createRunContext({
      changesetOverview: createChangeMap(),
      userContext: []
    }),
    promptSerializer: serializer
  });

  assert.deepEqual(
    steps.map((step) => step.stepId),
    [
      "review-basis",
      "candidate-findings",
      "semantic-validation",
      "review-summary"
    ]
  );
});

test("Candidate Findings, Semantic Validation, and Review Summary receive parseable ReviewStateSnapshot JSON", () => {
  const context = createContext();
  const finding = createFinding("F1");
  context.setFindings([finding]);
  context.setCandidateFindingsV3(createCandidateFindings());
  context.setValidationReportV1(createValidationReport([finding]));
  context.setMissingInformationItems([]);

  const stepPlans = [
    new CandidateFindingsStep({ promptSerializer: serializer }).prepare(context),
    new SemanticValidationStep({ promptSerializer: serializer }).prepare(context),
    new ReviewSummaryStep({ promptSerializer: serializer }).prepare(context)
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

  snapshots.forEach((snapshot) => {
    assertBaseSnapshot(snapshot, {
      expectedSections: {},
      expectEvidenceRefs: true
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
  assert.equal(snapshots[2].validationReport?.perFindingResults[0]?.findingId, "F1");
  assert.equal(snapshots[2].validationReport?.loopControl.action, "accept");
  assert.match(
    stepPlans[1].prompt.userMessage,
    /<candidate_ids>\n\["F1"\]\n<\/candidate_ids>/u
  );
  assert.equal(stepPlans[1].prompt.userMessage.includes("<candidate_findings"), false);
});
