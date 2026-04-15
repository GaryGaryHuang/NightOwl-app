import assert from "node:assert/strict";
import test from "node:test";

import { ReviewIndexFinalizer } from "../../../src/core/finalizers/review-index-finalizer.ts";
import {
  createFinding,
  createOutputTarget,
  createPlannedNotes,
  createSkippedFile,
  createSuccessfulFile
} from "../../helpers/completed-run-finalizer-contract-fixture.ts";

test("ReviewIndexFinalizer renders run metadata, artifacts, and file note links", () => {
  const finalizer = new ReviewIndexFinalizer();

  const rendered = finalizer.render({
    repoRoot: "/workspace/repo",
    baseRef: "main",
    headRef: "feature-branch",
    outputTarget: createOutputTarget(),
    plannedNotes: createPlannedNotes([
      plannedNote("README.md", "README.md.md"),
      plannedNote("src/app.ts", "src__app.ts.md"),
      plannedNote("packages/app/index.ts", "app__index.ts.md")
    ]),
    successfulFiles: [createSuccessfulFile("README.md", [])],
    skippedFiles: [
      createSkippedFile(
        "src/app.ts",
        "step4-findings-interrogation",
        "deterministic validation failed"
      ),
      createSkippedFile(
        "packages/app/index.ts",
        "step4-findings-interrogation",
        "deterministic validation failed"
      )
    ]
  });

  assert.match(rendered, /^# Review Index$/mu);
  assert.match(rendered, /- Repo root: `\/workspace\/repo`/u);
  assert.match(rendered, /- Base ref: `main`/u);
  assert.match(rendered, /- Head ref: `feature-branch`/u);
  assert.match(rendered, /- Planned files: 3/u);
  assert.match(rendered, /- Successful files: 1/u);
  assert.match(rendered, /- Skipped files: 2/u);
  assertRunArtifacts(rendered);
  assertTextContainsInOrder(rendered, [
    "- Repo root: `/workspace/repo`",
    "- Base ref: `main`",
    "- Head ref: `feature-branch`",
    "- Planned files: 3",
    "- Successful files: 1",
    "- Skipped files: 2",
    "## Run Artifacts",
    "- [changeset-overview.md](./changeset-overview.md)",
    "- [summary.md](./summary.md)",
    "- [skipped.md](./skipped.md)",
    "## File Notes",
    "- [None] [`README.md`](./files/README.md.md)",
    "- [Skipped] [`src/app.ts`](./files/src__app.ts.md)",
    "- [Skipped] [`packages/app/index.ts`](./files/app__index.ts.md)"
  ]);
});

test("ReviewIndexFinalizer renders explicit empty file notes for zero-file runs", () => {
  const finalizer = new ReviewIndexFinalizer();

  const rendered = finalizer.render({
    repoRoot: "/workspace/repo",
    baseRef: "main",
    headRef: "feature-branch",
    outputTarget: createOutputTarget(),
    plannedNotes: [],
    successfulFiles: [],
    skippedFiles: []
  });

  assert.match(rendered, /- Planned files: 0/u);
  assert.match(rendered, /- Successful files: 0/u);
  assert.match(rendered, /- Skipped files: 0/u);
  assertRunArtifacts(rendered);
  assert.match(rendered, /## File Notes\n- 無/u);
});

test("ReviewIndexFinalizer preserves collision-resolved note targets and forward slashes", () => {
  const finalizer = new ReviewIndexFinalizer();

  const rendered = finalizer.render({
    repoRoot: String.raw`C:\workspace\repo`,
    baseRef: "main",
    headRef: "feature-branch",
    outputTarget: createOutputTarget({
      basePath: String.raw`C:\workspace\.nightowl\review\feature-branch_03131430`,
      changesetOverviewPath: String.raw`C:\workspace\.nightowl\review\feature-branch_03131430\changeset-overview.md`,
      filesPath: String.raw`C:\workspace\.nightowl\review\feature-branch_03131430\files`,
      skippedPath: String.raw`C:\workspace\.nightowl\review\feature-branch_03131430\skipped.md`,
      summaryPath: String.raw`C:\workspace\.nightowl\review\feature-branch_03131430\summary.md`,
      indexPath: String.raw`C:\workspace\.nightowl\review\feature-branch_03131430\index.md`,
      manifestPath: String.raw`C:\workspace\.nightowl\review\feature-branch_03131430\manifest.json`,
      toolAuditPath: String.raw`C:\workspace\.nightowl\review\feature-branch_03131430\tool-audit.jsonl`
    }),
    plannedNotes: createPlannedNotes([
      windowsPlannedNote("src/api/index.ts", "src__api__index.ts.md"),
      windowsPlannedNote("tests/api/index.ts", "tests__api__index.ts.md")
    ]),
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
    outputTarget: createOutputTarget(),
    plannedNotes: createPlannedNotes([
      plannedNote("foo bar.ts", "foo bar.ts.md"),
      plannedNote("foo#bar).ts", "foo#bar).ts.md")
    ]),
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
    outputTarget: createOutputTarget(),
    plannedNotes: createPlannedNotes([
      plannedNote("none.ts"),
      plannedNote("low.ts"),
      plannedNote("medium.ts"),
      plannedNote("high.ts"),
      plannedNote("skipped.ts")
    ]),
    successfulFiles: [
      createSuccessfulFile("none.ts", []),
      createSuccessfulFile("low.ts", [createFinding("nice", 80, { title: "Low issue" })]),
      createSuccessfulFile("medium.ts", [createFinding("must", 80, { title: "Medium issue" })]),
      createSuccessfulFile("high.ts", [createFinding("must", 90, { title: "High issue" })])
    ],
    skippedFiles: [
      createSkippedFile(
        "skipped.ts",
        "step4-findings-interrogation",
        "deterministic validation failed"
      )
    ]
  });

  assertTextContainsInOrder(rendered, [
    "- [High] [`high.ts`]",
    "- [Medium] [`medium.ts`]",
    "- [Low] [`low.ts`]",
    "- [None] [`none.ts`]",
    "- [Skipped] [`skipped.ts`]"
  ]);
});

test("ReviewIndexFinalizer preserves planned order within the same risk level", () => {
  const finalizer = new ReviewIndexFinalizer();

  const rendered = finalizer.render({
    repoRoot: "/workspace/repo",
    baseRef: "main",
    headRef: "feature-branch",
    outputTarget: createOutputTarget(),
    plannedNotes: createPlannedNotes([
      plannedNote("a.ts"),
      plannedNote("b.ts"),
      plannedNote("c.ts")
    ]),
    successfulFiles: [
      createSuccessfulFile("a.ts", []),
      createSuccessfulFile("b.ts", []),
      createSuccessfulFile("c.ts", [])
    ],
    skippedFiles: []
  });

  assertTextContainsInOrder(rendered, [
    "- [None] [`a.ts`]",
    "- [None] [`b.ts`]",
    "- [None] [`c.ts`]"
  ]);
});

test("ReviewIndexFinalizer throws with identifying message when a planned file is absent from both outcome sets", () => {
  const finalizer = new ReviewIndexFinalizer();

  assert.throws(
    () =>
      finalizer.render({
        repoRoot: "/workspace/repo",
        baseRef: "main",
        headRef: "feature-branch",
        outputTarget: createOutputTarget(),
        plannedNotes: createPlannedNotes([
          plannedNote("src/missing.ts", "src__missing.ts.md")
        ]),
        successfulFiles: [],
        skippedFiles: []
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(
        error.message,
        "Missing finalized outcome for planned file: src/missing.ts"
      );
      return true;
    }
  );
});

test("ReviewIndexFinalizer labels a file present in both outcome sets as its risk level (successfulFiles wins)", () => {
  const finalizer = new ReviewIndexFinalizer();

  const rendered = finalizer.render({
    repoRoot: "/workspace/repo",
    baseRef: "main",
    headRef: "feature-branch",
    outputTarget: createOutputTarget(),
    plannedNotes: createPlannedNotes([
      plannedNote("src/both.ts", "src__both.ts.md")
    ]),
    successfulFiles: [createSuccessfulFile("src/both.ts", [])],
    skippedFiles: [createSkippedFile("src/both.ts", "step1-overview", "judge rejected")]
  });

  assert.match(rendered, /- \[None\] \[`src\/both\.ts`\]/u);
  assert.doesNotMatch(rendered, /\[Skipped\]/u);
});

function assertTextContainsInOrder(text: string, fragments: string[]): void {
  let cursor = 0;

  for (const fragment of fragments) {
    const index = text.indexOf(fragment, cursor);

    assert.ok(index >= 0, `expected fragment in order: ${fragment}`);
    cursor = index + fragment.length;
  }
}

function assertRunArtifacts(rendered: string): void {
  assertTextContainsInOrder(rendered, [
    "## Run Artifacts",
    "- [changeset-overview.md](./changeset-overview.md)",
    "- [summary.md](./summary.md)",
    "- [skipped.md](./skipped.md)"
  ]);
}

function plannedNote(
  filePath: string,
  noteName = `${filePath}.md`
): [filePath: string, noteFilePath: string] {
  return [
    filePath,
    `/workspace/.nightowl/review/feature-branch_03131430/files/${noteName}`
  ];
}

function windowsPlannedNote(
  filePath: string,
  noteName: string
): [filePath: string, noteFilePath: string] {
  return [
    filePath,
    `C:\\workspace\\.nightowl\\review\\feature-branch_03131430\\files\\${noteName}`
  ];
}
