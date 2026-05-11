import assert from "node:assert/strict";
import test from "node:test";

import { renderReviewIndex } from "../../../src/core/finalizers/review-index-finalizer.ts";
import type { PlannedNoteFile } from "../../../src/core/review-path-resolver.ts";
import type { SkippedFileOutcome, SuccessfulFileOutcome } from "../../../src/core/run-outcomes.ts";
import {
  createFinding,
  createOutputTarget,
  createPlannedNotes,
  createResolvedOutcomes,
  createSkippedFile,
  createSuccessfulFile
} from "../../helpers/completed-run-finalizer-contract-fixture.ts";

function renderIndex(input: {
  repoRoot?: string;
  baseRef?: string;
  headRef?: string;
  outputTarget?: ReturnType<typeof createOutputTarget>;
  plannedNotes: PlannedNoteFile[];
  successfulFiles: SuccessfulFileOutcome[];
  skippedFiles: SkippedFileOutcome[];
}): string {
  return renderReviewIndex({
    repoRoot: input.repoRoot ?? "/workspace/repo",
    baseRef: input.baseRef ?? "main",
    headRef: input.headRef ?? "feature-branch",
    outputTarget: input.outputTarget ?? createOutputTarget(),
    plannedNotes: input.plannedNotes,
    resolvedOutcomes: createResolvedOutcomes(input.plannedNotes, input.successfulFiles, input.skippedFiles)
  });
}

test("ReviewIndexFinalizer renders run metadata, artifacts, and file note links", () => {
  const rendered = renderIndex({
    plannedNotes: createPlannedNotes([
      plannedNote("README.md", "README.md.md"),
      plannedNote("src/app.ts", "src__app.ts.md"),
      plannedNote("packages/app/index.ts", "app__index.ts.md")
    ]),
    successfulFiles: [createSuccessfulFile("README.md", [])],
    skippedFiles: [
      createSkippedFile(
        "src/app.ts",
        "candidate-findings",
        "deterministic validation failed"
      ),
      createSkippedFile(
        "packages/app/index.ts",
        "candidate-findings",
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
  const rendered = renderIndex({
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
  const rendered = renderIndex({
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
  const rendered = renderIndex({
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

test("ReviewIndexFinalizer sorts file notes by High to Low to None with skipped files last", () => {
  const rendered = renderIndex({
    repoRoot: "/workspace/repo",
    baseRef: "main",
    headRef: "feature-branch",
    outputTarget: createOutputTarget(),
    plannedNotes: createPlannedNotes([
      plannedNote("none.ts"),
      plannedNote("low.ts"),
      plannedNote("another-high.ts"),
      plannedNote("high.ts"),
      plannedNote("skipped.ts")
    ]),
    successfulFiles: [
      createSuccessfulFile("none.ts", []),
      createSuccessfulFile("low.ts", [createFinding("nice", 80, { title: "Low issue" })]),
      createSuccessfulFile("another-high.ts", [createFinding("must", 80, { title: "Another high issue" })]),
      createSuccessfulFile("high.ts", [createFinding("must", 90, { title: "High issue" })])
    ],
    skippedFiles: [
      createSkippedFile(
        "skipped.ts",
        "candidate-findings",
        "deterministic validation failed"
      )
    ]
  });

  assertTextContainsInOrder(rendered, [
    "- [High] [`another-high.ts`]",
    "- [High] [`high.ts`]",
    "- [Low] [`low.ts`]",
    "- [None] [`none.ts`]",
    "- [Skipped] [`skipped.ts`]"
  ]);
});

test("ReviewIndexFinalizer preserves planned order within the same risk level", () => {
  const rendered = renderIndex({
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

test("ReviewIndexFinalizer distinguishes missing-information semantic stops from clean reviews", () => {
  const rendered = renderIndex({
    repoRoot: "/workspace/repo",
    baseRef: "main",
    headRef: "feature-branch",
    outputTarget: createOutputTarget(),
    plannedNotes: createPlannedNotes([
      plannedNote("src/clean.ts"),
      plannedNote("src/blocked.ts")
    ]),
    successfulFiles: [
      createSuccessfulFile("src/clean.ts", [], {
        status: "passed",
        semanticIterationCount: 1,
        candidateFindingCount: 0,
        approvedFindingCount: 0,
        missingInformationCount: 0,
        decisionCounts: {}
      }),
      createSuccessfulFile("src/blocked.ts", [], {
        status: "passed_with_limitations",
        loopAction: "accept",
        semanticIterationCount: 1,
        candidateFindingCount: 1,
        approvedFindingCount: 0,
        missingInformationCount: 1,
        decisionCounts: { drop: 1 }
      })
    ],
    skippedFiles: []
  });

  assert.match(
    rendered,
    /- \[None\]\[Passed\] \[`src\/clean\.ts`\]\(\.\/files\/src\/clean\.ts\.md\)/u
  );
  assert.match(
    rendered,
    /- \[None\]\[Limited\]\[MissingInfo\] \[`src\/blocked\.ts`\]\(\.\/files\/src\/blocked\.ts\.md\)/u
  );
  assert.match(
    rendered,
    /Missing information: 1 item; open the file note and read `## Missing Information`/u
  );
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
