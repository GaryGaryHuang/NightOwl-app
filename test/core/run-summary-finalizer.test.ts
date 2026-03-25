import assert from "node:assert/strict";
import test from "node:test";

import { RunSummaryFinalizer } from "../../src/core/run-summary-finalizer.ts";
import type {
  SuccessfulFileOutcome
} from "../../src/core/run-summary-finalizer.ts";

test("RunSummaryFinalizer renders the exact aggregate summary contract with rebased derived risk levels", () => {
  const finalizer = new RunSummaryFinalizer();

  const rendered = finalizer.render({
    repoRoot: "/workspace/repo",
    baseRef: "main",
    headRef: "feature-branch",
    plannedFileCount: 3,
    successfulFiles: [
      createSuccessfulFile("src/a.ts", [
        createFinding("must", 92, "Must finding"),
        createFinding("nice", 95, "Nice finding")
      ]),
      createSuccessfulFile("src/c.ts", [createFinding("must", 89, "Another must")])
    ],
    skippedFiles: [
      {
        filePath: "src/b.ts",
        stepId: "step5-validation-interrogation",
        reason: "deterministic validation failed"
      }
    ]
  });

  assert.equal(
    rendered,
    [
      "# Review Summary",
      "",
      "- Repo root: `/workspace/repo`",
      "- Base ref: `main`",
      "- Head ref: `feature-branch`",
      "- Planned files: 3",
      "- Successful files: 2",
      "- Skipped files: 1",
      "- Final findings totals: must=2, nice=1",
      "",
      "## Risk Distribution",
      "- High: 1",
      "- Medium: 1",
      "- Low: 0",
      "- None: 0",
      "",
      "## Successful Files",
      "- [High] `src/a.ts` — must=1, nice=1",
      "- [Medium] `src/c.ts` — must=1, nice=0",
      "",
      "## Skipped Files",
      "- `src/b.ts` — step5-validation-interrogation — deterministic validation failed"
    ].join("\n")
  );
});

test("RunSummaryFinalizer renders explicit empty sections for zero-file runs", () => {
  const finalizer = new RunSummaryFinalizer();

  const rendered = finalizer.render({
    repoRoot: "/workspace/repo",
    baseRef: "main",
    headRef: "feature-branch",
    plannedFileCount: 0,
    successfulFiles: [],
    skippedFiles: []
  });

  assert.equal(
    rendered,
    [
      "# Review Summary",
      "",
      "- Repo root: `/workspace/repo`",
      "- Base ref: `main`",
      "- Head ref: `feature-branch`",
      "- Planned files: 0",
      "- Successful files: 0",
      "- Skipped files: 0",
      "- Final findings totals: must=0, nice=0",
      "",
      "## Risk Distribution",
      "- High: 0",
      "- Medium: 0",
      "- Low: 0",
      "- None: 0",
      "",
      "## Successful Files",
      "- 無",
      "",
      "## Skipped Files",
      "- 無"
    ].join("\n")
  );
});

test("RunSummaryFinalizer excludes skipped files from final findings totals", () => {
  const finalizer = new RunSummaryFinalizer();

  const rendered = finalizer.render({
    repoRoot: "/workspace/repo",
    baseRef: "main",
    headRef: "feature-branch",
    plannedFileCount: 2,
    successfulFiles: [createSuccessfulFile("src/a.ts", [createFinding("nice", 91)])],
    skippedFiles: [
      {
        filePath: "src/b.ts",
        stepId: "step6-cognitive-simulation",
        reason: "deterministic validation failed"
      }
    ]
  });

  assert.match(rendered, /- Final findings totals: must=0, nice=1/u);
  assert.doesNotMatch(rendered, /must=1, nice=1/u);
});

test("RunSummaryFinalizer renders Risk Distribution section with High, Medium, Low, and None counts", () => {
  const finalizer = new RunSummaryFinalizer();

  const rendered = finalizer.render({
    repoRoot: "/workspace/repo",
    baseRef: "main",
    headRef: "feature-branch",
    plannedFileCount: 4,
    successfulFiles: [
      createSuccessfulFile("high.ts", [createFinding("must", 90, "High issue")]),
      createSuccessfulFile("medium.ts", [createFinding("must", 89, "Medium issue")]),
      createSuccessfulFile("low.ts", [createFinding("nice", 88, "Low issue")]),
      createSuccessfulFile("none.ts", [])
    ],
    skippedFiles: []
  });

  assert.match(rendered, /^## Risk Distribution$/mu);
  assert.match(rendered, /- High: 1/u);
  assert.match(rendered, /- Medium: 1/u);
  assert.match(rendered, /- Low: 1/u);
  assert.match(rendered, /- None: 1/u);
});

test("RunSummaryFinalizer sorts successful files by High to Medium to Low to None with planned-order tie-breaking", () => {
  const finalizer = new RunSummaryFinalizer();

  const rendered = finalizer.render({
    repoRoot: "/workspace/repo",
    baseRef: "main",
    headRef: "feature-branch",
    plannedFileCount: 5,
    successfulFiles: [
      createSuccessfulFile("a.ts", []),
      createSuccessfulFile("b.ts", [createFinding("nice", 80, "Low issue")]),
      createSuccessfulFile("c.ts", [createFinding("must", 80, "Medium issue")]),
      createSuccessfulFile("d.ts", [createFinding("must", 90, "High issue")]),
      createSuccessfulFile("e.ts", [])
    ],
    skippedFiles: []
  });

  const dIdx = rendered.indexOf("- [High] `d.ts`");
  const cIdx = rendered.indexOf("- [Medium] `c.ts`");
  const bIdx = rendered.indexOf("- [Low] `b.ts`");
  const aIdx = rendered.indexOf("- [None] `a.ts`");
  const eIdx = rendered.indexOf("- [None] `e.ts`");

  assert.ok(dIdx > 0, "d.ts should appear with [High] prefix");
  assert.ok(cIdx > 0, "c.ts should appear with [Medium] prefix");
  assert.ok(bIdx > 0, "b.ts should appear with [Low] prefix");
  assert.ok(aIdx > 0, "a.ts should appear with [None] prefix");
  assert.ok(eIdx > 0, "e.ts should appear with [None] prefix");
  assert.ok(dIdx < cIdx, "High risk d.ts should come before Medium risk c.ts");
  assert.ok(cIdx < bIdx, "Medium risk c.ts should come before Low risk b.ts");
  assert.ok(bIdx < aIdx, "Low risk b.ts should come before None risk a.ts");
  assert.ok(aIdx < eIdx, "a.ts should come before e.ts within the None bucket");
});

test("RunSummaryFinalizer preserves planned order for same-risk-level successful files", () => {
  const finalizer = new RunSummaryFinalizer();

  const rendered = finalizer.render({
    repoRoot: "/workspace/repo",
    baseRef: "main",
    headRef: "feature-branch",
    plannedFileCount: 3,
    successfulFiles: [
      createSuccessfulFile("a.ts", [createFinding("nice", 85, "Nice suggestion")]),
      createSuccessfulFile("b.ts", [createFinding("nice", 83, "Another nice")]),
      createSuccessfulFile("c.ts", [createFinding("nice", 81, "Yet another nice")])
    ],
    skippedFiles: []
  });

  const aIdx = rendered.indexOf("- [Low] `a.ts`");
  const bIdx = rendered.indexOf("- [Low] `b.ts`");
  const cIdx = rendered.indexOf("- [Low] `c.ts`");

  assert.ok(aIdx < bIdx && bIdx < cIdx, "same-risk files should preserve planned order a, b, c");
});

test("RunSummaryFinalizer renders each successful file with a rebased risk level prefix", () => {
  const finalizer = new RunSummaryFinalizer();

  const rendered = finalizer.render({
    repoRoot: "/workspace/repo",
    baseRef: "main",
    headRef: "feature-branch",
    plannedFileCount: 1,
    successfulFiles: [
      createSuccessfulFile("src/app.ts", [createFinding("nice", 85, "Nice suggestion")])
    ],
    skippedFiles: []
  });

  assert.match(rendered, /- \[Low\] `src\/app\.ts` — must=0, nice=1/u);
});

function createSuccessfulFile(
  filePath: string,
  findings: SuccessfulFileOutcome["findings"]
): SuccessfulFileOutcome {
  return { filePath, findings };
}

function createFinding(
  type: "must" | "nice",
  confidence: number,
  title = `${type} finding`
): SuccessfulFileOutcome["findings"][number] {
  return {
    type,
    title,
    traceability: { kind: "line-range" as const, lineStart: 1, lineEnd: 1 },
    context: "ctx",
    deviation: "dev",
    impact: "impact",
    suggestion: "suggestion",
    confidence
  };
}
