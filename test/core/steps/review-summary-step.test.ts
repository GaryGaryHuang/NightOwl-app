import assert from "node:assert/strict";
import test from "node:test";

import { FileReviewContext, type Finding } from "../../../src/core/file-review-context.ts";
import { ReviewSummaryStep } from "../../../src/core/steps/review-summary-step.ts";
import {
  createReviewSummaryResolve
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
  const classification = type === "must" ? "confirmed_problem" : "reasonable_risk";
  const severity = type === "must" ? "high" : "low";
  return {
    findingId,
    classification,
    severity,
    title: `${type} finding`,
    traceability: { kind: "line-range", lineStart: 1, lineEnd: 1 },
    evidence: "concrete evidence",
    triggerCondition: "trigger",
    impact: "impact",
    counterEvidence: ["checked"]
  } as Finding;
}

const FAKE_SERIALIZER = new ReviewStatePromptSerializer();

// --- createReviewSummaryResolve tests ---

test("createReviewSummaryResolve accepts narrative without external completion service", async () => {
  const context = createContext();
  const resolve = createReviewSummaryResolve({
    stepId: "review-summary",
    filePath: "src/app.ts",
    sectionKey: "summary"
  });

  const response = buildSummaryResponse();
  const applyTo = await resolve(response, createResolveServices());
  applyTo(context);

  assert.equal(context.getSection("summary"), response);
});

test("createReviewSummaryResolve rejects empty narrative packaging", async () => {
  const resolve = createReviewSummaryResolve({
    stepId: "review-summary",
    filePath: "src/app.ts",
    sectionKey: "summary"
  });

  await assert.rejects(
    () => resolve("", createResolveServices()),
    /narrative response is empty/u
  );
});

test("createReviewSummaryResolve rejects narrative missing required sections", async () => {
  const resolve = createReviewSummaryResolve({
    stepId: "review-summary",
    filePath: "src/app.ts",
    sectionKey: "summary"
  });

  await assert.rejects(
    () => resolve("### 審查依據\n- only one section", createResolveServices()),
    /missing required section: 行為變更提醒/u
  );
});

// --- Review Summary prepare() harness contract tests ---

test("ReviewSummaryStep.prepare() does not expose host-owned summary data blocks", () => {
  const step = new ReviewSummaryStep({ promptSerializer: FAKE_SERIALIZER });
  const context = createContext([createFinding("must", "F1"), createFinding("nice", "F2")]);
  const plan = step.prepare(context);

  assert.doesNotMatch(plan.prompt.userMessage, /<risk_snapshot>/u);
  assert.doesNotMatch(plan.prompt.userMessage, /<summary_status>/u);
});

test("ReviewSummaryStep.prepare() advertises resolver-required narrative sections", () => {
  const step = new ReviewSummaryStep({ promptSerializer: FAKE_SERIALIZER });
  const plan = step.prepare(createContext([]));
  const instruction = getReviewSummaryInstructionText(plan.prompt.userMessage);

  assert.match(instruction, /### 審查依據/u);
  assert.match(instruction, /### 行為變更提醒/u);
});

test("ReviewSummaryStep.resolve composes host-owned status data", async (t) => {
  const cases = [
    {
      name: "clean",
      setup: () => createContext([]),
      expected: {
        mustFixFindingCount: 0,
        niceToHaveFindingCount: 0,
        limitationSummary: "無"
      }
    },
    {
      name: "clean with limitations",
      setup: () => {
        const context = createContext([]) as SemanticFileReviewContext;
        context.setMissingInformationItems(createValidationReportV1().missingInformationItems);
        return context;
      },
      expected: {
        mustFixFindingCount: 0,
        niceToHaveFindingCount: 0,
        limitationSummary: "1 項 missing information"
      }
    },
    {
      name: "nice only",
      setup: () => createContext([createFinding("nice", "F1")]),
      expected: {
        mustFixFindingCount: 0,
        niceToHaveFindingCount: 1,
        limitationSummary: "無"
      }
    },
    {
      name: "must wins over nice",
      setup: () => createContext([createFinding("must", "F1"), createFinding("nice", "F2")]),
      expected: {
        mustFixFindingCount: 1,
        niceToHaveFindingCount: 1,
        limitationSummary: "無"
      }
    }
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      const step = new ReviewSummaryStep({ promptSerializer: FAKE_SERIALIZER });
      const context = testCase.setup();
      const plan = step.prepare(context);
      const mutation = await plan.resolve(
        buildNarrativeResponse(),
        createResolveServices()
      );
      mutation(context);

      const summary = context.getSection("summary") ?? "";
      const { beforeNarrative, afterNarrative } = splitComposedReport(summary);
      assert.doesNotMatch(beforeNarrative, /- 結論：/u);
      assert.match(
        beforeNarrative,
        new RegExp(`must-fix ${testCase.expected.mustFixFindingCount}；nice-to-have ${testCase.expected.niceToHaveFindingCount}`, "u")
      );
      assert.match(
        beforeNarrative,
        new RegExp(`審查限制：${testCase.expected.limitationSummary}`, "u")
      );
      assert.equal(afterNarrative.trim(), "");
    });
  }
});

test("ReviewSummaryStep.prepare() consumes approved findings and missing-information state", () => {
  const step = new ReviewSummaryStep({ promptSerializer: FAKE_SERIALIZER });
  const context = createContext([createFinding("nice", "F1")]) as SemanticFileReviewContext;
  context.setCandidateFindings(createCandidateFindings("must"));
  const validationReport = createValidationReportV1();
  context.setValidationReportV1(validationReport);
  context.setMissingInformationItems(createValidationReportV1().missingInformationItems);
  const plan = step.prepare(context);

  const reviewState = parseReviewStateFromPrompt(plan.prompt.userMessage);
  assert.equal(reviewState.candidateFindings, null);
  assert.deepEqual(reviewState.validationReport, validationReport);
  assert.deepEqual(
    reviewState.approvedFindings.map((finding: Finding) => finding.findingId),
    ["F1"]
  );
  assert.deepEqual(reviewState.missingInformationItems, [
    {
      itemId: "MI1",
      description: "Need the external null-input contract.",
      whyItMatters: "Without it the validator cannot prove expected behavior."
    }
  ]);
});

test("ReviewSummaryStep.resolve composes host-owned report shell around narrative response", async () => {
  const step = new ReviewSummaryStep({ promptSerializer: FAKE_SERIALIZER });
  const context = createContext([
    createFinding("must", "F1"),
    createFinding("nice", "F2")
  ]) as SemanticFileReviewContext;
  context.setMissingInformationItems(createValidationReportV1().missingInformationItems);
  const plan = step.prepare(context);

  const mutation = await plan.resolve(
    buildNarrativeResponse(),
    createResolveServices()
  );
  mutation(context);

  const summary = context.getSection("summary") ?? "";
  const { beforeNarrative, afterNarrative } = splitComposedReport(summary);

  assert.match(summary, /^## Summary/mu);
  assert.doesNotMatch(beforeNarrative, /- 結論：/u);
  assert.match(beforeNarrative, /must-fix 1/u);
  assert.match(beforeNarrative, /nice-to-have 1/u);
  assert.match(beforeNarrative, /1 項 missing information/u);
  assert.equal(afterNarrative.trim(), "");
});

// --- helpers ---

function buildSummaryResponse(): string {
  return [
    "## Summary",
    buildNarrativeResponse()
  ].join("\n");
}

function buildNarrativeResponse(): string {
  return [
    "### 審查依據",
    "- 異動概要：value changed from 1 to 2.",
    "- 已核對依據：validated review state.",
    "- 待確認資訊：無",
    "### 行為變更提醒",
    "- 無行為變更"
  ].join("\n");
}

function splitComposedReport(summary: string): {
  beforeNarrative: string;
  afterNarrative: string;
} {
  const narrative = buildNarrativeResponse();
  const narrativeIndex = summary.indexOf(narrative);
  assert.notEqual(narrativeIndex, -1);
  return {
    beforeNarrative: summary.slice(0, narrativeIndex),
    afterNarrative: summary.slice(narrativeIndex + narrative.length)
  };
}

function createResolveServices(): StepResolveServices {
  return {
    validator: new StructuredOutputValidator()
  };
}

type SemanticFileReviewContext = FileReviewContext & {
  setCandidateFindings(payload: ReturnType<typeof createCandidateFindings>): void;
  setValidationReportV1(report: ReturnType<typeof createValidationReportV1>): void;
  setMissingInformationItems(items: ReturnType<typeof createValidationReportV1>["missingInformationItems"]): void;
};

function parseReviewStateFromPrompt(prompt: string): {
  candidateFindings: unknown[] | null;
  approvedFindings: Finding[];
  missingInformationItems: ReturnType<typeof createValidationReportV1>["missingInformationItems"];
  validationReport: ReturnType<typeof createValidationReportV1> | null;
} {
  const match = prompt.match(
    /<review_state format="json">\n([\s\S]*?)\n<\/review_state>/u
  );
  assert.ok(match, "review_state JSON block should be present");
  return JSON.parse(match[1]);
}

function getReviewSummaryInstructionText(prompt: string): string {
  const reviewStateEnd = prompt.indexOf("</review_state>");
  assert.notEqual(reviewStateEnd, -1, "review_state block should be present");
  return prompt.slice(reviewStateEnd + "</review_state>".length);
}

function createCandidateFindings(_type: "must" | "nice") {
  return {
    findings: [
      {
        findingId: "F-raw-candidate",
        classification: "confirmed_problem",
        severity: "high",
        title: "raw candidate must not shape Review Summary",
        traceability: { kind: "line-range" as const, lineStart: 1, lineEnd: 1 },
        evidence: "candidate evidence",
        triggerCondition: "candidate trigger",
        impact: "candidate impact",
        counterEvidence: ["candidate counter-evidence"]
      }
    ],
    findingOrigins: [
      {
        findingIndex: 1,
        kind: "hypothesis",
        hypothesisIds: ["H1"],
        evidenceIds: ["E1"],
        rationale: "candidate closes H1"
      }
    ],
    hypothesisClosure: [
      {
        hypothesisId: "H1",
        status: "closed_by_candidate",
        rationale: "candidate closes H1"
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
        itemId: "MI1",
        description: "Need the external null-input contract.",
        whyItMatters: "Without it the validator cannot prove expected behavior."
      }
    ],
    loopControl: { action: "accept", reason: "all gates passed" }
  };
}
