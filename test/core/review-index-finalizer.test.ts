import assert from "node:assert/strict";
import test from "node:test";

import { ReviewIndexFinalizer } from "../../src/core/review-index-finalizer.ts";

test("ReviewIndexFinalizer renders the exact review index contract with planned-order file-note links", () => {
  const finalizer = new ReviewIndexFinalizer();

  const rendered = finalizer.render({
    repoRoot: "/workspace/repo",
    baseRef: "main",
    headRef: "feature-branch",
    plannedFileCount: 3,
    outputTarget: {
      basePath: "/workspace/review/feature-branch_03131430",
      filesPath: "/workspace/review/feature-branch_03131430/files",
      skippedPath: "/workspace/review/feature-branch_03131430/skipped.md",
      summaryPath: "/workspace/review/feature-branch_03131430/summary.md",
      indexPath: "/workspace/review/feature-branch_03131430/index.md"
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
    successfulFiles: [
      { filePath: "README.md", findings: [] }
    ],
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
      "- [Low] [`README.md`](./files/README.md.md)",
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
    plannedFileCount: 0,
    outputTarget: {
      basePath: "/workspace/review/feature-branch_03131430",
      filesPath: "/workspace/review/feature-branch_03131430/files",
      skippedPath: "/workspace/review/feature-branch_03131430/skipped.md",
      summaryPath: "/workspace/review/feature-branch_03131430/summary.md",
      indexPath: "/workspace/review/feature-branch_03131430/index.md"
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
    repoRoot: "C:\\workspace\\repo",
    baseRef: "main",
    headRef: "feature-branch",
    plannedFileCount: 2,
    outputTarget: {
      basePath: "C:\\workspace\\review\\feature-branch_03131430",
      filesPath: "C:\\workspace\\review\\feature-branch_03131430\\files",
      skippedPath: "C:\\workspace\\review\\feature-branch_03131430\\skipped.md",
      summaryPath: "C:\\workspace\\review\\feature-branch_03131430\\summary.md",
      indexPath: "C:\\workspace\\review\\feature-branch_03131430\\index.md"
    },
    plannedNotes: [
      {
        filePath: "src/api/index.ts",
        noteFilePath:
          "C:\\workspace\\review\\feature-branch_03131430\\files\\src__api__index.ts.md"
      },
      {
        filePath: "tests/api/index.ts",
        noteFilePath:
          "C:\\workspace\\review\\feature-branch_03131430\\files\\tests__api__index.ts.md"
      }
    ],
    successfulFiles: [
      { filePath: "src/api/index.ts", findings: [] },
      { filePath: "tests/api/index.ts", findings: [] }
    ],
    skippedFiles: []
  });

  assert.match(rendered, /- \[Low\] \[`src\/api\/index\.ts`\]\(\.\/files\/src__api__index\.ts\.md\)/u);
  assert.match(
    rendered,
    /- \[Low\] \[`tests\/api\/index\.ts`\]\(\.\/files\/tests__api__index\.ts\.md\)/u
  );
  assert.doesNotMatch(rendered, /\\files\\/u);
});

test("ReviewIndexFinalizer percent-encodes Markdown-unsafe note targets", () => {
  const finalizer = new ReviewIndexFinalizer();

  const rendered = finalizer.render({
    repoRoot: "/workspace/repo",
    baseRef: "main",
    headRef: "feature-branch",
    plannedFileCount: 2,
    outputTarget: {
      basePath: "/workspace/review/feature-branch_03131430",
      filesPath: "/workspace/review/feature-branch_03131430/files",
      skippedPath: "/workspace/review/feature-branch_03131430/skipped.md",
      summaryPath: "/workspace/review/feature-branch_03131430/summary.md",
      indexPath: "/workspace/review/feature-branch_03131430/index.md"
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
      { filePath: "foo bar.ts", findings: [] },
      { filePath: "foo#bar).ts", findings: [] }
    ],
    skippedFiles: []
  });

  assert.match(rendered, /- \[Low\] \[`foo bar\.ts`\]\(\.\/files\/foo%20bar\.ts\.md\)/u);
  assert.match(rendered, /- \[Low\] \[`foo#bar\)\.ts`\]\(\.\/files\/foo%23bar%29\.ts\.md\)/u);
  assert.doesNotMatch(rendered, /\(\.\/files\/foo bar\.ts\.md\)/u);
  assert.doesNotMatch(rendered, /\(\.\/files\/foo#bar\)\.ts\.md\)/u);
});

test("ReviewIndexFinalizer sorts file notes by risk level with skipped files last", () => {
  const finalizer = new ReviewIndexFinalizer();

  const rendered = finalizer.render({
    repoRoot: "/workspace/repo",
    baseRef: "main",
    headRef: "feature-branch",
    plannedFileCount: 3,
    outputTarget: {
      basePath: "/workspace/review/feature-branch_03131430",
      filesPath: "/workspace/review/feature-branch_03131430/files",
      skippedPath: "/workspace/review/feature-branch_03131430/skipped.md",
      summaryPath: "/workspace/review/feature-branch_03131430/summary.md",
      indexPath: "/workspace/review/feature-branch_03131430/index.md"
    },
    plannedNotes: [
      {
        filePath: "low.ts",
        noteFilePath: "/workspace/review/feature-branch_03131430/files/low.ts.md"
      },
      {
        filePath: "high.ts",
        noteFilePath: "/workspace/review/feature-branch_03131430/files/high.ts.md"
      },
      {
        filePath: "skipped.ts",
        noteFilePath: "/workspace/review/feature-branch_03131430/files/skipped.ts.md"
      }
    ],
    successfulFiles: [
      {
        filePath: "low.ts",
        findings: []
      },
      {
        filePath: "high.ts",
        findings: [
          {
            type: "must",
            title: "Must issue",
            context: "ctx",
            deviation: "dev",
            impact: "impact",
            suggestion: "fix",
            confidence: 80
          }
        ]
      }
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
  const lowIdx = rendered.indexOf("- [Low] [`low.ts`]");
  const skippedIdx = rendered.indexOf("- [Skipped] [`skipped.ts`]");

  assert.ok(highIdx > 0, "high.ts should appear with [High] prefix");
  assert.ok(lowIdx > 0, "low.ts should appear with [Low] prefix");
  assert.ok(skippedIdx > 0, "skipped.ts should appear with [Skipped] prefix");
  assert.ok(highIdx < lowIdx, "[High] file should come before [Low] file");
  assert.ok(lowIdx < skippedIdx, "[Low] file should come before [Skipped] file");
});

test("ReviewIndexFinalizer preserves planned order within same risk level", () => {
  const finalizer = new ReviewIndexFinalizer();

  const rendered = finalizer.render({
    repoRoot: "/workspace/repo",
    baseRef: "main",
    headRef: "feature-branch",
    plannedFileCount: 3,
    outputTarget: {
      basePath: "/workspace/review/feature-branch_03131430",
      filesPath: "/workspace/review/feature-branch_03131430/files",
      skippedPath: "/workspace/review/feature-branch_03131430/skipped.md",
      summaryPath: "/workspace/review/feature-branch_03131430/summary.md",
      indexPath: "/workspace/review/feature-branch_03131430/index.md"
    },
    plannedNotes: [
      {
        filePath: "a.ts",
        noteFilePath: "/workspace/review/feature-branch_03131430/files/a.ts.md"
      },
      {
        filePath: "b.ts",
        noteFilePath: "/workspace/review/feature-branch_03131430/files/b.ts.md"
      },
      {
        filePath: "c.ts",
        noteFilePath: "/workspace/review/feature-branch_03131430/files/c.ts.md"
      }
    ],
    successfulFiles: [
      { filePath: "a.ts", findings: [] },
      { filePath: "b.ts", findings: [] },
      { filePath: "c.ts", findings: [] }
    ],
    skippedFiles: []
  });

  const aIdx = rendered.indexOf("- [Low] [`a.ts`]");
  const bIdx = rendered.indexOf("- [Low] [`b.ts`]");
  const cIdx = rendered.indexOf("- [Low] [`c.ts`]");

  assert.ok(aIdx < bIdx && bIdx < cIdx, "same-risk files should preserve planned order a, b, c");
});

test("ReviewIndexFinalizer renders zero-file run with explicit empty marker", () => {
  const finalizer = new ReviewIndexFinalizer();

  const rendered = finalizer.render({
    repoRoot: "/workspace/repo",
    baseRef: "main",
    headRef: "feature-branch",
    plannedFileCount: 0,
    outputTarget: {
      basePath: "/workspace/review/feature-branch_03131430",
      filesPath: "/workspace/review/feature-branch_03131430/files",
      skippedPath: "/workspace/review/feature-branch_03131430/skipped.md",
      summaryPath: "/workspace/review/feature-branch_03131430/summary.md",
      indexPath: "/workspace/review/feature-branch_03131430/index.md"
    },
    plannedNotes: [],
    successfulFiles: [],
    skippedFiles: []
  });

  assert.match(rendered, /^## File Notes$/mu);
  assert.match(rendered, /- 無/u);
});
