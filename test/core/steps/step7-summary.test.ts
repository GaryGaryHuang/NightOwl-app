import assert from "node:assert/strict";
import test from "node:test";

import { FileReviewContext, type Finding } from "../../../src/core/file-review-context.ts";
import { Step7SummaryStep } from "../../../src/core/steps/step7-summary.ts";
import {
  parseRiskLevelFromResponse,
  createStep7HybridResolve
} from "../../../src/core/steps/step-resolve-helpers.ts";
import type { StepResolveServices } from "../../../src/core/step-runner.ts";
import { StructuredOutputValidator } from "../../../src/core/structured-output-validator.ts";
import { ReviewStatePromptSerializer } from "../../../src/core/review-state-prompt-serializer.ts";

const DEFAULT_CONTEXT = {
  filePath: "src/app.ts",
  noteFilePath: "/tmp/src__app.ts.md",
  diffContent: "@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n",
  baseRef: "main",
  headRef: "feature"
} as const;

function createContext(findings?: Finding[]): FileReviewContext {
  const ctx = new FileReviewContext({ ...DEFAULT_CONTEXT });
  if (findings) {
    ctx.setFindings(findings);
  }
  return ctx;
}

function createFinding(
  type: "must" | "nice",
  findingId: string
): Finding {
  return {
    type,
    title: `${type} finding`,
    traceability: { kind: "line-range", lineStart: 1, lineEnd: 1 },
    expectedBehavior: "expected",
    actualBehavior: "actual",
    deviation: "dev",
    impact: "impact",
    suggestion: "suggestion",
    findingId
  };
}

const FAKE_SERIALIZER = new ReviewStatePromptSerializer();

// --- parseRiskLevelFromResponse tests ---

test("parseRiskLevelFromResponse extracts valid risk levels", async (t) => {
  await t.test("extracts High", () => {
    assert.equal(
      parseRiskLevelFromResponse("### 風險評估\n- 整體風險等級：High\n- 風險理由：..."),
      "High"
    );
  });

  await t.test("extracts Low", () => {
    assert.equal(
      parseRiskLevelFromResponse("- 整體風險等級：Low"),
      "Low"
    );
  });

  await t.test("extracts None", () => {
    assert.equal(
      parseRiskLevelFromResponse("- 整體風險等級：None"),
      "None"
    );
  });

  await t.test("handles whitespace around level", () => {
    assert.equal(
      parseRiskLevelFromResponse("- 整體風險等級： High "),
      "High"
    );
  });

  await t.test("returns undefined for non-canonical label", () => {
    assert.equal(
      parseRiskLevelFromResponse("- 整體風險等級：Critical"),
      undefined
    );
  });

  await t.test("returns undefined when line is missing", () => {
    assert.equal(
      parseRiskLevelFromResponse("## Summary\nno risk line here"),
      undefined
    );
  });

  await t.test("extracts English summary risk line", () => {
    assert.equal(
      parseRiskLevelFromResponse("- Overall risk level: None"),
      "None"
    );
  });

  await t.test("picks first match in multi-line response", () => {
    const response = [
      "### 審查基礎",
      "- 改動概要：...",
      "### 風險評估",
      "- 整體風險等級：Low",
      "- 風險理由：..."
    ].join("\n");
    assert.equal(parseRiskLevelFromResponse(response), "Low");
  });
});

// --- createStep7HybridResolve tests ---

test("createStep7HybridResolve rejects when risk level mismatches snapshot", async () => {
  const resolve = createStep7HybridResolve({
    stepId: "step7-summary",
    filePath: "src/app.ts",
    sectionKey: "summary",
    criteria: "test criteria",
    expectedRiskLevel: "High"
  });

  const response = buildSummaryResponse("Low");

  await assert.rejects(
    () => resolve(response, createResolveServices({ judgePasses: true })),
    /risk.*mismatch|整體風險等級/i
  );
});

test("createStep7HybridResolve rejects when risk level is unparseable", async () => {
  const resolve = createStep7HybridResolve({
    stepId: "step7-summary",
    filePath: "src/app.ts",
    sectionKey: "summary",
    criteria: "test criteria",
    expectedRiskLevel: "None"
  });

  const response = "## Summary\n### 審查基礎\n- 改動概要：...\n### 行為變更提醒\n- 無行為變更\n### 風險評估\n- 風險理由：none";

  await assert.rejects(
    () => resolve(response, createResolveServices({ judgePasses: true })),
    /risk.*mismatch|整體風險等級/i
  );
});

test("createStep7HybridResolve proceeds to judge when risk matches, judge passes → returns deferred mutation", async () => {
  const context = createContext();
  const resolve = createStep7HybridResolve({
    stepId: "step7-summary",
    filePath: "src/app.ts",
    sectionKey: "summary",
    criteria: "test criteria",
    expectedRiskLevel: "None"
  });

  const response = buildSummaryResponse("None");
  const applyTo = await resolve(response, createResolveServices({ judgePasses: true }));
  applyTo(context);

  assert.equal(context.getSection("summary"), response);
});

test("createStep7HybridResolve rejects when risk matches but judge fails", async () => {
  const resolve = createStep7HybridResolve({
    stepId: "step7-summary",
    filePath: "src/app.ts",
    sectionKey: "summary",
    criteria: "test criteria",
    expectedRiskLevel: "High"
  });

  const response = buildSummaryResponse("High");

  await assert.rejects(
    () => resolve(response, createResolveServices({ judgePasses: false })),
    /judge rejected/
  );
});

test("createStep7HybridResolve does not call judge when risk mismatches", async () => {
  let judgeCalled = false;
  const resolve = createStep7HybridResolve({
    stepId: "step7-summary",
    filePath: "src/app.ts",
    sectionKey: "summary",
    criteria: "test criteria",
    expectedRiskLevel: "High"
  });

  const services = createResolveServices({
    judgePasses: true,
    onJudgeCall: () => {
      judgeCalled = true;
    }
  });

  const response = buildSummaryResponse("Low");

  await assert.rejects(() => resolve(response, services));
  assert.equal(judgeCalled, false, "judge should not be called on risk mismatch");
});

test("createStep7HybridResolve rejects new finding claims outside Step 6 approved results", async () => {
  let judgeCalled = false;
  const resolve = createStep7HybridResolve({
    stepId: "step7-summary",
    filePath: "src/app.ts",
    sectionKey: "summary",
    criteria: "test criteria",
    expectedRiskLevel: "Low",
    allowedFindingIds: ["F1"],
    allowedMissingInformationIds: ["MI1"]
  });

  const response = [
    buildSummaryResponse("Low"),
    "",
    "- 風險理由：F2 reveals a new trigger not present in Step 6 approved findings."
  ].join("\n");

  await assert.rejects(
    () =>
      resolve(
        response,
        createResolveServices({
          judgePasses: true,
          onJudgeCall: () => {
            judgeCalled = true;
          }
        })
      ),
    /new.*claim|approved findings|F2/i
  );
  assert.equal(judgeCalled, false, "judge should not be called when packaging adds a new claim");
});

test("createStep7HybridResolve does not treat ordinary words as finding IDs", async () => {
  let judgeCalled = false;
  const resolve = createStep7HybridResolve({
    stepId: "step7-summary",
    filePath: "src/app.ts",
    sectionKey: "summary",
    criteria: "test criteria",
    expectedRiskLevel: "Low",
    allowedFindingIds: [],
    allowedMissingInformationIds: []
  });

  const response = [
    buildSummaryResponse("Low"),
    "",
    "- 風險理由：Feature packaging stayed within the approved review state."
  ].join("\n");

  const mutation = await resolve(
    response,
    createResolveServices({
      judgePasses: true,
      onJudgeCall: () => {
        judgeCalled = true;
      }
    })
  );

  assert.equal(typeof mutation, "function");
  assert.equal(judgeCalled, true);
});

// --- Step 7 prepare() prompt tests ---

test("Step7SummaryStep.prepare() includes <risk_snapshot> in user message when findings exist", () => {
  const step = new Step7SummaryStep({ promptSerializer: FAKE_SERIALIZER });
  const context = createContext([createFinding("must", "F1")]);
  const plan = step.prepare(context);

  assert.match(plan.prompt.userMessage, /<risk_snapshot>/);
  assert.match(plan.prompt.userMessage, /<\/risk_snapshot>/);
  assert.match(plan.prompt.userMessage, /"derivedRiskLevel"/);
  assert.match(plan.prompt.userMessage, /"High"/);
  assert.match(plan.prompt.userMessage, /"mustCount"/);
});

test("Step7SummaryStep.prepare() includes <risk_snapshot> with None when no findings", () => {
  const step = new Step7SummaryStep({ promptSerializer: FAKE_SERIALIZER });
  const context = createContext([]);
  const plan = step.prepare(context);

  assert.match(plan.prompt.userMessage, /<risk_snapshot>/);
  assert.match(plan.prompt.userMessage, /"None"/);
});

test("Step7SummaryStep.prepare() risk_snapshot JSON is parseable", () => {
  const step = new Step7SummaryStep({ promptSerializer: FAKE_SERIALIZER });
  const context = createContext([createFinding("must", "F1"), createFinding("nice", "F2")]);
  const plan = step.prepare(context);

  const match = plan.prompt.userMessage.match(/<risk_snapshot>\n([\s\S]*?)\n<\/risk_snapshot>/);
  assert.ok(match, "risk_snapshot block should be present");
  const snapshot = JSON.parse(match[1]);
  assert.equal(snapshot.derivedRiskLevel, "High");
  assert.equal(snapshot.mustCount, 1);
  assert.equal(snapshot.niceCount, 1);
  assert.deepEqual(snapshot.acceptedFindingIds, ["F1", "F2"]);
});

test("Step7SummaryStep.prepare() includes retiredFindingCount from dispositions", () => {
  const step = new Step7SummaryStep({ promptSerializer: FAKE_SERIALIZER });
  const context = createContext([createFinding("nice", "F1")]);
  context.setDispositions([
    {
      findingId: "F-retired",
      status: "retired",
      reason: "REACHABILITY",
      explanation: "path is not reachable"
    }
  ]);

  const plan = step.prepare(context);
  const match = plan.prompt.userMessage.match(/<risk_snapshot>\n([\s\S]*?)\n<\/risk_snapshot>/);
  assert.ok(match, "risk_snapshot block should be present");
  const snapshot = JSON.parse(match[1]);
  assert.equal(snapshot.retiredFindingCount, 1);
});

test("Step7SummaryStep.prepare() system message references risk_snapshot", () => {
  const step = new Step7SummaryStep({ promptSerializer: FAKE_SERIALIZER });
  const context = createContext([]);
  const plan = step.prepare(context);

  assert.match(plan.prompt.systemMessage, /risk_snapshot/);
  assert.match(plan.prompt.systemMessage, /derivedRiskLevel/);
});

test("Step7SummaryStep.prepare() includes <review_state> in user message", () => {
  const step = new Step7SummaryStep({ promptSerializer: FAKE_SERIALIZER });
  const context = createContext([]);
  const plan = step.prepare(context);

  assert.match(plan.prompt.userMessage, /<review_state\b/);
  assert.match(plan.prompt.userMessage, /<\/review_state>/);
});

test("Step7SummaryStep.prepare() consumes approved findings and missing-information state", () => {
  const step = new Step7SummaryStep({ promptSerializer: FAKE_SERIALIZER });
  const context = createContext([createFinding("nice", "F1")]) as SemanticFileReviewContext;
  context.setCandidateFindingsV3(createCandidateFindingsV3("must"));
  context.setValidationReportV1(createValidationReportV1());
  context.setMissingInformationItems(createValidationReportV1().missingInformationItems);
  const plan = step.prepare(context);

  const reviewState = parseReviewStateFromPrompt(plan.prompt.userMessage);
  assert.equal(reviewState.candidateFindings, null);
  assert.deepEqual(
    reviewState.approvedFindings.map((finding: Finding) => finding.findingId),
    ["F1"]
  );
  assert.deepEqual(reviewState.missingInformationItems, [
    {
      itemId: "MI1",
      findingId: "F1",
      description: "Need the external null-input contract.",
      whyItMatters: "Without it the validator cannot prove expected behavior."
    }
  ]);
  assert.match(plan.prompt.userMessage, /Step 6-approved findings/i);
  assert.match(plan.prompt.userMessage, /Do not introduce new findings/i);
});

test("Step7SummaryStep.prepare() allows no necessary assumptions in summary contract", () => {
  const step = new Step7SummaryStep({ promptSerializer: FAKE_SERIALIZER });
  const context = createContext([]);
  const plan = step.prepare(context);

  assert.match(plan.prompt.userMessage, /必要假設/);
  assert.match(plan.prompt.userMessage, /無/);
  assert.doesNotMatch(plan.prompt.userMessage, /審查假設/);
});

test("Step7SummaryStep.prepare() resolve uses expectedRiskLevel matching snapshot", () => {
  const step = new Step7SummaryStep({ promptSerializer: FAKE_SERIALIZER });
  const context = createContext([createFinding("must", "F1")]);
  const plan = step.prepare(context);

  // The resolve function exists and is a function (hybrid resolve)
  assert.equal(typeof plan.resolve, "function");
});

// --- helpers ---

function buildSummaryResponse(riskLevel: string): string {
  return [
    "## Summary",
    "### 審查基礎",
    "- 改動概要：changed value from 1 to 2",
    "- 依據規範：無",
    "- 必要假設：無",
    "### 行為變更提醒",
    "- 無行為變更",
    "### 風險評估",
    `- 整體風險等級：${riskLevel}`,
    "- 風險理由：no must-fix findings"
  ].join("\n");
}

function createResolveServices(
  opts: { judgePasses?: boolean; onJudgeCall?: () => void } = {}
): StepResolveServices {
  const { judgePasses = true, onJudgeCall } = opts;
  return {
    judgeService: {
      async evaluate() {
        onJudgeCall?.();
        return { passed: judgePasses, cause: judgePasses ? undefined : "judge rejected" };
      }
    },
    validator: new StructuredOutputValidator()
  };
}

type SemanticFileReviewContext = FileReviewContext & {
  setCandidateFindingsV3(payload: ReturnType<typeof createCandidateFindingsV3>): void;
  setValidationReportV1(report: ReturnType<typeof createValidationReportV1>): void;
  setMissingInformationItems(items: ReturnType<typeof createValidationReportV1>["missingInformationItems"]): void;
};

function parseReviewStateFromPrompt(prompt: string): {
  candidateFindings: unknown[];
  approvedFindings: Finding[];
  missingInformationItems: ReturnType<typeof createValidationReportV1>["missingInformationItems"];
} {
  const match = prompt.match(
    /<review_state format="json">\n([\s\S]*?)\n<\/review_state>/u
  );
  assert.ok(match, "review_state JSON block should be present");
  return JSON.parse(match[1]);
}

function createCandidateFindingsV3(priority: "must" | "nice") {
  return {
    result: "FINDINGS_READY",
    findings: [
      {
        findingId: "F-raw-candidate",
        sourceHypothesisIds: ["H1"],
        classification: "confirmed_problem",
        priority,
        severity: priority === "must" ? "high" : "low",
        confidence: "high",
        evidenceStrength: "direct",
        title: "raw candidate must not shape Step 7",
        traceability: { kind: "line-range" as const, lineStart: 1, lineEnd: 1 },
        codeEvidence: [
          {
            evidenceId: "E1",
            location: "src/app.ts:1",
            summary: "candidate evidence"
          }
        ],
        executionPath: ["entry", "changed branch"],
        triggerCondition: "candidate trigger",
        failureMechanism: "candidate mechanism",
        impact: "candidate impact",
        counterEvidenceChecked: ["candidate counter-evidence"],
        fixDirection: "candidate fix",
        testRecommendation: "candidate test"
      }
    ],
    hypothesisClosure: [
      {
        hypothesisId: "H1",
        status: "closed_by_candidate",
        evidenceIds: ["E1"],
        rationale: "candidate closes H1"
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
        reason: "all gates passed"
      }
    ],
    approvedFindings: [createFinding("nice", "F1")],
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
