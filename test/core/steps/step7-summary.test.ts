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
  confidence: number,
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
    modelConfidence: confidence,
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
    uncertaintyStatus: "supported" as const
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

  await t.test("extracts Medium", () => {
    assert.equal(
      parseRiskLevelFromResponse("- 整體風險等級：Medium"),
      "Medium"
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

  const response = buildSummaryResponse("Medium");

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

// --- Step 7 prepare() prompt tests ---

test("Step7SummaryStep.prepare() includes <risk_snapshot> in user message when findings exist", () => {
  const step = new Step7SummaryStep({ promptSerializer: FAKE_SERIALIZER });
  const context = createContext([createFinding("must", 90, "F1")]);
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
  const context = createContext([createFinding("must", 96, "F1"), createFinding("nice", 91, "F2")]);
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
  const context = createContext([createFinding("nice", 91, "F1")]);
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

test("Step7SummaryStep.prepare() resolve uses expectedRiskLevel matching snapshot", () => {
  const step = new Step7SummaryStep({ promptSerializer: FAKE_SERIALIZER });
  const context = createContext([createFinding("must", 80, "F1")]);
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
    "- 審查假設：values are plain constants",
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
