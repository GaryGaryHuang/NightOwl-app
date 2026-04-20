import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { ChangeMap, ChangeMapCategory } from "../../../src/core/change-map.ts";
import { FileReviewContext } from "../../../src/core/file-review-context.ts";
import {
  resolveHypothesisCountClass,
  Step4StrategyWhatIfScenariosStep,
  type HypothesisCountClass
} from "../../../src/core/steps/step4-strategy-what-if-scenarios.ts";

// ---------------------------------------------------------------------------
// resolveHypothesisCountClass — category → count-class mapping
// ---------------------------------------------------------------------------

describe("resolveHypothesisCountClass", () => {
  const cases: [ChangeMapCategory, HypothesisCountClass][] = [
    ["docs", "zero"],
    ["test", "zero"],
    ["config", "low"],
    ["refactor", "low"],
    ["feature", "normal"],
    ["bugfix", "normal"]
  ];

  for (const [category, expected] of cases) {
    it(`maps "${category}" → "${expected}"`, () => {
      assert.equal(resolveHypothesisCountClass(category), expected);
    });
  }
});

// ---------------------------------------------------------------------------
// Step4StrategyWhatIfScenariosStep.prepare — count-class-driven instruction
// ---------------------------------------------------------------------------

function makeChangeMap(
  files: { path: string; category: ChangeMapCategory }[]
): ChangeMap {
  return Object.freeze({
    schemaVersion: 1 as const,
    overviewMarkdown: "## Changeset Overview\n",
    changedFiles: Object.freeze(
      files.map((f) =>
        Object.freeze({
          path: f.path,
          status: "M" as const,
          category: f.category,
          basis: "diff-inspected" as const
        })
      )
    ),
    behaviorChanges: Object.freeze([]),
    unresolvedUnknowns: Object.freeze([])
  });
}

function makeContext(filePath: string): FileReviewContext {
  return new FileReviewContext({
    filePath,
    noteFilePath: `review/${filePath}.md`,
    diffContent: `--- a/${filePath}\n+++ b/${filePath}\n@@ -1,3 +1,3 @@\n-old\n+new`,
    baseRef: "main",
    headRef: "feature"
  });
}

function buildStep(changeMap: ChangeMap): Step4StrategyWhatIfScenariosStep {
  return new Step4StrategyWhatIfScenariosStep({
    promptSerializer: { serialize: () => "<review_state/>" },
    changeMap
  });
}

describe("Step4StrategyWhatIfScenariosStep.prepare — count class", () => {
  it("uses normal count rules for feature files", () => {
    const step = buildStep(makeChangeMap([{ path: "src/app.ts", category: "feature" }]));
    const plan = step.prepare(makeContext("src/app.ts"));

    assert.ok(plan.prompt.userMessage.includes("3–5"), "instruction should mention 3–5");
    assert.ok(!plan.prompt.userMessage.includes("無需驗證情境"), "should not mention zero-class marker");
  });

  it("uses normal count rules for bugfix files", () => {
    const step = buildStep(makeChangeMap([{ path: "src/fix.ts", category: "bugfix" }]));
    const plan = step.prepare(makeContext("src/fix.ts"));

    assert.ok(plan.prompt.userMessage.includes("3–5"));
  });

  it("uses low count rules for config files", () => {
    const step = buildStep(makeChangeMap([{ path: "config.json", category: "config" }]));
    const plan = step.prepare(makeContext("config.json"));

    assert.ok(plan.prompt.userMessage.includes("1–2"), "instruction should mention 1–2");
    assert.ok(!plan.prompt.userMessage.includes("3–5"), "should not mention normal range");
  });

  it("uses low count rules for refactor files", () => {
    const step = buildStep(makeChangeMap([{ path: "src/util.ts", category: "refactor" }]));
    const plan = step.prepare(makeContext("src/util.ts"));

    assert.ok(plan.prompt.userMessage.includes("1–2"));
  });

  it("uses zero count rules for docs files", () => {
    const step = buildStep(makeChangeMap([{ path: "README.md", category: "docs" }]));
    const plan = step.prepare(makeContext("README.md"));

    assert.ok(plan.prompt.userMessage.includes("無需驗證情境"), "instruction should mention zero-class marker");
    assert.ok(plan.prompt.userMessage.includes("docs-only or test-only"));
  });

  it("uses zero count rules for test files", () => {
    const step = buildStep(makeChangeMap([{ path: "test/app.test.ts", category: "test" }]));
    const plan = step.prepare(makeContext("test/app.test.ts"));

    assert.ok(plan.prompt.userMessage.includes("無需驗證情境"));
  });

  it("defaults to normal when file is not found in ChangeMap", () => {
    const step = buildStep(makeChangeMap([{ path: "other.ts", category: "docs" }]));
    const plan = step.prepare(makeContext("src/unknown.ts"));

    assert.ok(plan.prompt.userMessage.includes("3–5"), "should fall back to normal");
  });

  it("prohibits 6+ scenarios in all count classes", () => {
    for (const category of ["feature", "bugfix", "config", "refactor", "docs", "test"] as ChangeMapCategory[]) {
      const step = buildStep(makeChangeMap([{ path: "f.ts", category }]));
      const plan = step.prepare(makeContext("f.ts"));

      assert.ok(
        !plan.prompt.userMessage.includes("6–8"),
        `${category}: instruction must not mention 6–8`
      );
    }
  });
});
