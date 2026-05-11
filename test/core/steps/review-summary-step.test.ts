import assert from "node:assert/strict";
import test from "node:test";

import { FileReviewContext, type Finding } from "../../../src/core/file-review-context.ts";
import { ReviewSummaryStep } from "../../../src/core/steps/review-summary-step.ts";
import {
  parseRiskLevelFromResponse,
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

// --- parseRiskLevelFromResponse tests ---

test("parseRiskLevelFromResponse extracts valid risk levels", async (t) => {
  await t.test("extracts High", () => {
    assert.equal(
      parseRiskLevelFromResponse("- 整體風險等級：High"),
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
      "before",
      "- 整體風險等級：Low",
      "- 整體風險等級：High"
    ].join("\n");
    assert.equal(parseRiskLevelFromResponse(response), "Low");
  });
});

// --- createReviewSummaryResolve tests ---

test("createReviewSummaryResolve rejects when risk level mismatches snapshot", async () => {
  const resolve = createReviewSummaryResolve({
    stepId: "review-summary",
    filePath: "src/app.ts",
    sectionKey: "summary",
    expectedRiskLevel: "High"
  });

  const response = buildSummaryResponse("Low");

  await assert.rejects(
    () => resolve(response, createResolveServices()),
    /risk.*mismatch|整體風險等級/i
  );
});

test("createReviewSummaryResolve rejects when risk level is unparseable", async () => {
  const resolve = createReviewSummaryResolve({
    stepId: "review-summary",
    filePath: "src/app.ts",
    sectionKey: "summary",
    expectedRiskLevel: "None"
  });

  const response = [
    buildNarrativeResponse(),
    "No risk line"
  ].join("\n");

  await assert.rejects(
    () => resolve(response, createResolveServices()),
    /risk.*mismatch|整體風險等級/i
  );
});

test("createReviewSummaryResolve accepts matching risk without external completion service", async () => {
  const context = createContext();
  const resolve = createReviewSummaryResolve({
    stepId: "review-summary",
    filePath: "src/app.ts",
    sectionKey: "summary",
    expectedRiskLevel: "None"
  });

  const response = buildSummaryResponse("None");
  const applyTo = await resolve(response, createResolveServices());
  applyTo(context);

  assert.equal(context.getSection("summary"), response);
});

test("createReviewSummaryResolve rejects empty narrative packaging", async () => {
  const resolve = createReviewSummaryResolve({
    stepId: "review-summary",
    filePath: "src/app.ts",
    sectionKey: "summary",
    expectedRiskLevel: "None"
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
    sectionKey: "summary",
    expectedRiskLevel: "None"
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

test("ReviewSummaryStep.prepare() frames internal review state as source material for reader-facing prose", () => {
  const step = new ReviewSummaryStep({ promptSerializer: FAKE_SERIALIZER });
  const plan = step.prepare(createContext([]));
  const instruction = getReviewSummaryInstructionText(plan.prompt.userMessage);

  assert.match(
    plan.prompt.systemMessage,
    /reader-facing narrative portion of the final per-file review summary/u
  );
  assert.match(
    plan.prompt.systemMessage,
    /provided review state as the evidence source[\s\S]*internal record names, validator objects, and bookkeeping are private source material/u
  );
  assert.doesNotMatch(plan.prompt.systemMessage, /run-level index\/summary/u);
  assert.doesNotMatch(plan.prompt.systemMessage, /## Findings|## Missing Information|designated first response heading/u);
  assert.match(
    instruction,
    /private source material[\s\S]*not printed verbatim in the final review output/u
  );
  assert.match(
    instruction,
    /Internal source labels are never report wording[\s\S]*Use them only to locate source data[\s\S]*reviewBasis[\s\S]*approvedFindings[\s\S]*validationReport[\s\S]*missingInformationItems[\s\S]*Candidate Findings[\s\S]*Semantic Validation/u
  );
  assert.match(
    instruction,
    /Required output sections, in this order; begin with `### 審查依據`:[\s\S]*### 行為變更提醒[\s\S]*### 風險判定理由/u
  );
  assert.match(
    instruction,
    /Section line shapes:[\s\S]*異動概要[\s\S]*已核對依據[\s\S]*待確認資訊/u
  );
  assert.match(
    instruction,
    /Source-material translation rules:[\s\S]*Translate internal source material into reader-facing statements/u
  );
  assert.match(
    instruction,
    /final `<review_state>\.missingInformationItems` array[\s\S]*If that final list is empty, write exactly `無`/u
  );
  assert.match(
    instruction,
    /Completion policy:[\s\S]*do not add an outer summary heading, conclusion or action sections/u
  );
  assert.match(
    instruction,
    /Complete Markdown output example:[\s\S]*The label is explanatory only/u
  );
  assert.doesNotMatch(
    instruction,
    /Clean example:|Limited example:|src\/api\.ts/u
  );
});

test("ReviewSummaryStep.resolve composes host-owned status data", async (t) => {
  const cases = [
    {
      name: "clean",
      setup: () => createContext([]),
      expected: {
        riskLevel: "None",
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
        riskLevel: "None",
        mustFixFindingCount: 0,
        niceToHaveFindingCount: 0,
        limitationSummary: "1 項 missing information",
        actionPattern: /審查限制：仍有 1 項 missing information/u
      }
    },
    {
      name: "nice only",
      setup: () => createContext([createFinding("nice", "F1")]),
      expected: {
        riskLevel: "Low",
        mustFixFindingCount: 0,
        niceToHaveFindingCount: 1,
        limitationSummary: "無"
      }
    },
    {
      name: "must wins over nice",
      setup: () => createContext([createFinding("must", "F1"), createFinding("nice", "F2")]),
      expected: {
        riskLevel: "High",
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
      assert.equal(
        parseRiskLevelFromResponse(beforeNarrative),
        testCase.expected.riskLevel
      );
      assert.match(
        beforeNarrative,
        new RegExp(`must-fix ${testCase.expected.mustFixFindingCount}；nice-to-have ${testCase.expected.niceToHaveFindingCount}`, "u")
      );
      assert.match(
        beforeNarrative,
        new RegExp(`審查限制：${testCase.expected.limitationSummary}`, "u")
      );
      assert.notEqual(afterNarrative.trim(), "");
      const actionPattern =
        "actionPattern" in testCase.expected ? testCase.expected.actionPattern : undefined;
      if (actionPattern) {
        assert.match(afterNarrative, actionPattern);
      }
    });
  }
});

test("ReviewSummaryStep.prepare() consumes approved findings and missing-information state", () => {
  const step = new ReviewSummaryStep({ promptSerializer: FAKE_SERIALIZER });
  const context = createContext([createFinding("nice", "F1")]) as SemanticFileReviewContext;
  context.setCandidateFindingsV3(createCandidateFindingsV3("must"));
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
  assert.equal(parseRiskLevelFromResponse(beforeNarrative), "High");
  assert.match(beforeNarrative, /must-fix 1/u);
  assert.match(beforeNarrative, /nice-to-have 1/u);
  assert.match(beforeNarrative, /1 項 missing information/u);
  assert.match(afterNarrative, /審查限制：仍有 1 項 missing information/u);
  assert.notEqual(afterNarrative.trim(), "");
});

test("ReviewSummaryStep.resolve rejects narrative that tries to own host-computed report fields", async () => {
  const step = new ReviewSummaryStep({ promptSerializer: FAKE_SERIALIZER });
  const context = createContext([]);
  const plan = step.prepare(context);

  await assert.rejects(
    () =>
      plan.resolve(
        [
          buildNarrativeResponse(),
          "- 整體風險等級：Low"
        ].join("\n"),
        createResolveServices()
      ),
    /host-computed report field/u
  );
});

test("ReviewSummaryStep.resolve rejects narrative that tries to own host-composed sections", async (t) => {
  const cases = ["### 審查結論", "### 後續行動"];

  for (const heading of cases) {
    await t.test(heading, async () => {
      const step = new ReviewSummaryStep({ promptSerializer: FAKE_SERIALIZER });
      const context = createContext([]);
      const plan = step.prepare(context);

      await assert.rejects(
        () =>
          plan.resolve(
            [
              buildNarrativeResponse(),
              heading,
              "- model-owned action guidance"
            ].join("\n"),
            createResolveServices()
          ),
        /host-computed report field/u
      );
    });
  }
});

// --- helpers ---

function buildSummaryResponse(riskLevel: string): string {
  return [
    "## Summary",
    `- 整體風險等級：${riskLevel}`,
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
    "- 無行為變更",
    "### 風險判定理由",
    "- Review result follows from validated review state."
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
  setCandidateFindingsV3(payload: ReturnType<typeof createCandidateFindingsV3>): void;
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

function createCandidateFindingsV3(_type: "must" | "nice") {
  return {
    result: "FINDINGS_READY",
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
