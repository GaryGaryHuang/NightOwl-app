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
    successfulFileCount: 1,
    skippedFileCount: 2,
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
      "- [`README.md`](./files/README.md.md)",
      "- [`src/app.ts`](./files/src__app.ts.md)",
      "- [`packages/app/index.ts`](./files/app__index.ts.md)"
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
    successfulFileCount: 0,
    skippedFileCount: 0,
    outputTarget: {
      basePath: "/workspace/review/feature-branch_03131430",
      filesPath: "/workspace/review/feature-branch_03131430/files",
      skippedPath: "/workspace/review/feature-branch_03131430/skipped.md",
      summaryPath: "/workspace/review/feature-branch_03131430/summary.md",
      indexPath: "/workspace/review/feature-branch_03131430/index.md"
    },
    plannedNotes: []
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
    successfulFileCount: 2,
    skippedFileCount: 0,
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
    ]
  });

  assert.match(rendered, /- \[`src\/api\/index\.ts`\]\(\.\/files\/src__api__index\.ts\.md\)/u);
  assert.match(
    rendered,
    /- \[`tests\/api\/index\.ts`\]\(\.\/files\/tests__api__index\.ts\.md\)/u
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
    successfulFileCount: 2,
    skippedFileCount: 0,
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
    ]
  });

  assert.match(rendered, /- \[`foo bar\.ts`\]\(\.\/files\/foo%20bar\.ts\.md\)/u);
  assert.match(rendered, /- \[`foo#bar\)\.ts`\]\(\.\/files\/foo%23bar%29\.ts\.md\)/u);
  assert.doesNotMatch(rendered, /\(\.\/files\/foo bar\.ts\.md\)/u);
  assert.doesNotMatch(rendered, /\(\.\/files\/foo#bar\)\.ts\.md\)/u);
});
