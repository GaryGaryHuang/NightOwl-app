import assert from "node:assert/strict";
import test from "node:test";

import { ReviewIndexFinalizer } from "../../src/core/review-index-finalizer.ts";
import type {
  SuccessfulFileOutcome
} from "../../src/core/run-summary-finalizer.ts";

test("ReviewIndexFinalizer renders the exact review index contract with rebased risk labels", () => {
  const finalizer = new ReviewIndexFinalizer();

  const rendered = finalizer.render({
    repoRoot: "/workspace/repo",
    baseRef: "main",
    headRef: "feature-branch",
    outputTarget: {
      basePath: "/workspace/review/feature-branch_03131430",
      filesPath: "/workspace/review/feature-branch_03131430/files",
      skippedPath: "/workspace/review/feature-branch_03131430/skipped.md",
      summaryPath: "/workspace/review/feature-branch_03131430/summary.md",
      indexPath: "/workspace/review/feature-branch_03131430/index.md",
      manifestPath: "/workspace/review/feature-branch_03131430/manifest.json",
      toolAuditPath: "/workspace/review/feature-branch_03131430/tool-audit.jsonl"
    },
    plannedNotes: [
      {
        filePath: "README.md",
        noteFilePath: "/workspace/review/feature-branch_03131430/files/README.md.md"
      },
      {
        filePath: "src/app.ts",
        noteFilePath: "/workspace/review/feature-branch_03131430/files/src__app.ts.md"
      },
      {
        filePath: "packages/app/index.ts",
        noteFilePath: "/workspace/review/feature-branch_03131430/files/app__index.ts.md"
      }
    ],
    successfulFiles: [createSuccessfulFile("README.md", [])],
    skippedFiles: [
      {
        filePath: "src/app.ts",
        stepId: "step4-findings-interrogation",
        reason: "deterministic validation failed"
      },
      {
        filePath: "packages/app/index.ts",
        stepId: "step4-findings-interrogation",
        reason: "deterministic validation failed"
      }
    ]
  });

  assert.equal(
    rendered,
    [
      "# Review Index",
      "",
      "- Repo root: `/workspace/repo`",
      "- Base ref: `main`",
      "- Head ref: `feature-branch`",
      "- Planned files: 3",
      "- Successful files: 1",
      "- Skipped files: 2",
      "",
      "## Run Artifacts",
      "- [summary.md](./summary.md)",
      "- [skipped.md](./skipped.md)",
      "",
      "## File Notes",
      "- [None] [`README.md`](./files/README.md.md)",
      "- [Skipped] [`src/app.ts`](./files/src__app.ts.md)",
      "- [Skipped] [`packages/app/index.ts`](./files/app__index.ts.md)"
    ].join("\n")
  );
});

test("ReviewIndexFinalizer renders explicit empty file notes for zero-file runs", () => {
  const finalizer = new ReviewIndexFinalizer();

  const rendered = finalizer.render({
    repoRoot: "/workspace/repo",
    baseRef: "main",
    headRef: "feature-branch",
    outputTarget: {
      basePath: "/workspace/review/feature-branch_03131430",
      filesPath: "/workspace/review/feature-branch_03131430/files",
      skippedPath: "/workspace/review/feature-branch_03131430/skipped.md",
      summaryPath: "/workspace/review/feature-branch_03131430/summary.md",
      indexPath: "/workspace/review/feature-branch_03131430/index.md",
      manifestPath: "/workspace/review/feature-branch_03131430/manifest.json",
      toolAuditPath: "/workspace/review/feature-branch_03131430/tool-audit.jsonl"
    },
    plannedNotes: [],
    successfulFiles: [],
    skippedFiles: []
  });

  assert.equal(
    rendered,
    [
      "# Review Index",
      "",
      "- Repo root: `/workspace/repo`",
      "- Base ref: `main`",
      "- Head ref: `feature-branch`",
      "- Planned files: 0",
      "- Successful files: 0",
      "- Skipped files: 0",
      "",
      "## Run Artifacts",
      "- [summary.md](./summary.md)",
      "- [skipped.md](./skipped.md)",
      "",
      "## File Notes",
      "- 無"
    ].join("\n")
  );
});

test("ReviewIndexFinalizer preserves collision-resolved note targets and forward slashes", () => {
  const finalizer = new ReviewIndexFinalizer();

  const rendered = finalizer.render({
    repoRoot: String.raw`C:\workspace\repo`,
    baseRef: "main",
    headRef: "feature-branch",
    outputTarget: {
      basePath: String.raw`C:\workspace\review\feature-branch_03131430`,
      filesPath: String.raw`C:\workspace\review\feature-branch_03131430\files`,
      skippedPath: String.raw`C:\workspace\review\feature-branch_03131430\skipped.md`,
      summaryPath: String.raw`C:\workspace\review\feature-branch_03131430\summary.md`,
      indexPath: String.raw`C:\workspace\review\feature-branch_03131430\index.md`,
      manifestPath: String.raw`C:\workspace\review\feature-branch_03131430\manifest.json`,
      toolAuditPath: String.raw`C:\workspace\review\feature-branch_03131430\tool-audit.jsonl`
    },
    plannedNotes: [
      {
        filePath: "src/api/index.ts",
        noteFilePath: String.raw`C:\workspace\review\feature-branch_03131430\files\src__api__index.ts.md`
      },
      {
        filePath: "tests/api/index.ts",
        noteFilePath: String.raw`C:\workspace\review\feature-branch_03131430\files\tests__api__index.ts.md`
      }
    ],
    successfulFiles: [
      createSuccessfulFile("src/api/index.ts", []),
      createSuccessfulFile("tests/api/index.ts", [])
    ],
    skippedFiles: []
  });

  assert.match(rendered, /- \[None\] \[`src\/api\/index\.ts`\]\(\.\/files\/src__api__index\.ts\.md\)/u);
  assert.match(
    rendered,
    /- \[None\] \[`tests\/api\/index\.ts`\]\(\.\/files\/tests__api__index\.ts\.md\)/u
  );
  assert.doesNotMatch(rendered, /\\files\\/u);
});

test("ReviewIndexFinalizer percent-encodes Markdown-unsafe note targets", () => {
  const finalizer = new ReviewIndexFinalizer();

  const rendered = finalizer.render({
    repoRoot: "/workspace/repo",
    baseRef: "main",
    headRef: "feature-branch",
    outputTarget: {
      basePath: "/workspace/review/feature-branch_03131430",
      filesPath: "/workspace/review/feature-branch_03131430/files",
      skippedPath: "/workspace/review/feature-branch_03131430/skipped.md",
      summaryPath: "/workspace/review/feature-branch_03131430/summary.md",
      indexPath: "/workspace/review/feature-branch_03131430/index.md",
      manifestPath: "/workspace/review/feature-branch_03131430/manifest.json",
      toolAuditPath: "/workspace/review/feature-branch_03131430/tool-audit.jsonl"
    },
    plannedNotes: [
      {
        filePath: "foo bar.ts",
        noteFilePath: "/workspace/review/feature-branch_03131430/files/foo bar.ts.md"
      },
      {
        filePath: "foo#bar).ts",
        noteFilePath: "/workspace/review/feature-branch_03131430/files/foo#bar).ts.md"
      }
    ],
    successfulFiles: [
      createSuccessfulFile("foo bar.ts", []),
      createSuccessfulFile("foo#bar).ts", [])
    ],
    skippedFiles: []
  });

  assert.match(rendered, /- \[None\] \[`foo bar\.ts`\]\(\.\/files\/foo%20bar\.ts\.md\)/u);
  assert.match(rendered, /- \[None\] \[`foo#bar\)\.ts`\]\(\.\/files\/foo%23bar%29\.ts\.md\)/u);
  assert.doesNotMatch(rendered, /\(\.\/files\/foo bar\.ts\.md\)/u);
  assert.doesNotMatch(rendered, /\(\.\/files\/foo#bar\)\.ts\.md\)/u);
});

test("ReviewIndexFinalizer sorts file notes by High to Medium to Low to None with skipped files last", () => {
  const finalizer = new ReviewIndexFinalizer();

  const rendered = finalizer.render({
    repoRoot: "/workspace/repo",
    baseRef: "main",
    headRef: "feature-branch",
    outputTarget: {
      basePath: "/workspace/review/feature-branch_03131430",
      filesPath: "/workspace/review/feature-branch_03131430/files",
      skippedPath: "/workspace/review/feature-branch_03131430/skipped.md",
      summaryPath: "/workspace/review/feature-branch_03131430/summary.md",
      indexPath: "/workspace/review/feature-branch_03131430/index.md",
      manifestPath: "/workspace/review/feature-branch_03131430/manifest.json",
      toolAuditPath: "/workspace/review/feature-branch_03131430/tool-audit.jsonl"
    },
    plannedNotes: [
      { filePath: "none.ts", noteFilePath: "/workspace/review/feature-branch_03131430/files/none.ts.md" },
      { filePath: "low.ts", noteFilePath: "/workspace/review/feature-branch_03131430/files/low.ts.md" },
      { filePath: "medium.ts", noteFilePath: "/workspace/review/feature-branch_03131430/files/medium.ts.md" },
      { filePath: "high.ts", noteFilePath: "/workspace/review/feature-branch_03131430/files/high.ts.md" },
      { filePath: "skipped.ts", noteFilePath: "/workspace/review/feature-branch_03131430/files/skipped.ts.md" }
    ],
    successfulFiles: [
      createSuccessfulFile("none.ts", []),
      createSuccessfulFile("low.ts", [createFinding("nice", 80, "Low issue")]),
      createSuccessfulFile("medium.ts", [createFinding("must", 80, "Medium issue")]),
      createSuccessfulFile("high.ts", [createFinding("must", 90, "High issue")])
    ],
    skippedFiles: [
      {
        filePath: "skipped.ts",
        stepId: "step4-findings-interrogation",
        reason: "deterministic validation failed"
      }
    ]
  });

  const highIdx = rendered.indexOf("- [High] [`high.ts`]");
  const mediumIdx = rendered.indexOf("- [Medium] [`medium.ts`]");
  const lowIdx = rendered.indexOf("- [Low] [`low.ts`]");
  const noneIdx = rendered.indexOf("- [None] [`none.ts`]");
  const skippedIdx = rendered.indexOf("- [Skipped] [`skipped.ts`]");

  assert.ok(highIdx > 0, "high.ts should appear with [High] prefix");
  assert.ok(mediumIdx > 0, "medium.ts should appear with [Medium] prefix");
  assert.ok(lowIdx > 0, "low.ts should appear with [Low] prefix");
  assert.ok(noneIdx > 0, "none.ts should appear with [None] prefix");
  assert.ok(skippedIdx > 0, "skipped.ts should appear with [Skipped] prefix");
  assert.ok(highIdx < mediumIdx, "[High] file should come before [Medium] file");
  assert.ok(mediumIdx < lowIdx, "[Medium] file should come before [Low] file");
  assert.ok(lowIdx < noneIdx, "[Low] file should come before [None] file");
  assert.ok(noneIdx < skippedIdx, "[None] file should come before [Skipped] file");
});

test("ReviewIndexFinalizer preserves planned order within the same risk level", () => {
  const finalizer = new ReviewIndexFinalizer();

  const rendered = finalizer.render({
    repoRoot: "/workspace/repo",
    baseRef: "main",
    headRef: "feature-branch",
    outputTarget: {
      basePath: "/workspace/review/feature-branch_03131430",
      filesPath: "/workspace/review/feature-branch_03131430/files",
      skippedPath: "/workspace/review/feature-branch_03131430/skipped.md",
      summaryPath: "/workspace/review/feature-branch_03131430/summary.md",
      indexPath: "/workspace/review/feature-branch_03131430/index.md",
      manifestPath: "/workspace/review/feature-branch_03131430/manifest.json",
      toolAuditPath: "/workspace/review/feature-branch_03131430/tool-audit.jsonl"
    },
    plannedNotes: [
      { filePath: "a.ts", noteFilePath: "/workspace/review/feature-branch_03131430/files/a.ts.md" },
      { filePath: "b.ts", noteFilePath: "/workspace/review/feature-branch_03131430/files/b.ts.md" },
      { filePath: "c.ts", noteFilePath: "/workspace/review/feature-branch_03131430/files/c.ts.md" }
    ],
    successfulFiles: [
      createSuccessfulFile("a.ts", []),
      createSuccessfulFile("b.ts", []),
      createSuccessfulFile("c.ts", [])
    ],
    skippedFiles: []
  });

  const aIdx = rendered.indexOf("- [None] [`a.ts`]");
  const bIdx = rendered.indexOf("- [None] [`b.ts`]");
  const cIdx = rendered.indexOf("- [None] [`c.ts`]");

  assert.ok(aIdx < bIdx && bIdx < cIdx, "same-risk files should preserve planned order a, b, c");
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
    context: "ctx",
    deviation: "dev",
    impact: "impact",
    suggestion: "suggestion",
    confidence
  };
}
