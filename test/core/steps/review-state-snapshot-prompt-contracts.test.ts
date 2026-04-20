import assert from "node:assert/strict";
import test from "node:test";

import type { ChangeMap } from "../../../src/core/change-map.ts";
import { FileReviewContext, type Finding } from "../../../src/core/file-review-context.ts";
import {
  ReviewStatePromptSerializer,
  type ReviewStateSnapshot
} from "../../../src/core/review-state-prompt-serializer.ts";
import { Step2DependenciesBoundariesStep } from "../../../src/core/steps/step2-dependencies-boundaries.ts";
import { Step3KnowledgeSourceOfTruthStep } from "../../../src/core/steps/step3-knowledge-source-of-truth.ts";
import { Step4StrategyWhatIfScenariosStep } from "../../../src/core/steps/step4-strategy-what-if-scenarios.ts";
import { Step5ValidationInterrogationStep } from "../../../src/core/steps/step5-validation-interrogation.ts";
import { Step6CognitiveSimulationStep } from "../../../src/core/steps/step6-cognitive-simulation.ts";
import { Step7SummaryStep } from "../../../src/core/steps/step7-summary.ts";

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
    "## Knowledge & Source of Truth\n- 版本／文件參考：無\n- 採用規則與假設：plain string value\n- 排除範圍：outside files"
  );
  context.setSection(
    "strategy-what-if-scenarios",
    "## Strategy & What-if Scenarios\n- What-if 假設情境：\n  - W1: value changes"
  );

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
    modelConfidence: 85,
    findingId,
    supportingEvidence: [
      { evidenceRef: "E1", supports: "expectedBehavior" },
      { evidenceRef: "E2", supports: "actualBehavior" },
      { evidenceRef: "E3", supports: "reachability" },
      { evidenceRef: "E4", supports: "impact" }
    ],
    reachability: {
      credible: true,
      entryPoint: "main entry",
      guardsChecked: ["guard"],
      description: "reachable"
    },
    uncertaintyStatus: "supported",
    sourceHypothesisId: "W1"
  };
}

function createChangeMap(): ChangeMap {
  return {
    schemaVersion: 1,
    overviewMarkdown: "## Changeset Overview\n",
    changedFiles: [
      {
        path: "src/app.ts",
        status: "M",
        category: "feature",
        group: "app",
        basis: "diff-inspected"
      }
    ],
    fileGroups: [
      {
        id: "G1",
        label: "app",
        files: ["src/app.ts"],
        observedChange: "app changed"
      }
    ],
    crossFileBoundaries: [],
    testCoverageObservations: [],
    behaviorChanges: [],
    evidenceRefs: [],
    unresolvedUnknowns: []
  };
}

function parseReviewStateFromPrompt(prompt: string): ReviewStateSnapshot {
  const match = prompt.match(
    /<review_state format="json">\n([\s\S]*?)\n<\/review_state>/u
  );
  assert.ok(match, "review_state JSON block should be present");
  return JSON.parse(match[1]);
}

function assertBaseSnapshot(snapshot: ReviewStateSnapshot): void {
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
  assert.match(snapshot.sections.overview ?? "", /^## Overview/u);
  assert.deepEqual(snapshot.evidenceRefs, []);
}

test("Steps 2-7 receive parseable ReviewStateSnapshot JSON", () => {
  const context = createContext();
  const finding = createFinding("F1");
  context.setFindings([finding]);

  const stepPlans = [
    new Step2DependenciesBoundariesStep({ promptSerializer: serializer }).prepare(context),
    new Step3KnowledgeSourceOfTruthStep({ promptSerializer: serializer }).prepare(context),
    new Step4StrategyWhatIfScenariosStep({
      promptSerializer: serializer,
      changeMap: createChangeMap()
    }).prepare(context),
    new Step5ValidationInterrogationStep({ promptSerializer: serializer }).prepare(context),
    new Step6CognitiveSimulationStep({ promptSerializer: serializer }).prepare(context),
    new Step7SummaryStep({ promptSerializer: serializer }).prepare(context)
  ];

  const snapshots = stepPlans.map((plan) =>
    parseReviewStateFromPrompt(plan.prompt.userMessage)
  );

  for (const snapshot of snapshots) {
    assertBaseSnapshot(snapshot);
  }

  assert.equal(snapshots[4].candidateFindings[0].findingId, "F1");
  assert.deepEqual(snapshots[4].verifiedFindings, []);
  assert.equal(snapshots[5].verifiedFindings[0].findingId, "F1");
  assert.deepEqual(snapshots[5].candidateFindings, []);
  assert.equal(stepPlans[4].prompt.userMessage.includes("<candidate_findings"), false);
});
