import assert from "node:assert/strict";
import test from "node:test";

import { RunSummaryFinalizer } from "../../src/core/run-summary-finalizer.ts";
import {
  createFinding,
  createSkippedFile,
  createSuccessfulFile
} from "../helpers/completed-run-finalizer-contract-fixture.ts";

test("RunSummaryFinalizer renders the exact aggregate summary contract with rebased derived risk levels", () => {
  const finalizer = new RunSummaryFinalizer();

  const rendered = finalizer.render({
    repoRoot: "/workspace/repo",
    baseRef: "main",
    headRef: "feature-branch",
    plannedFileCount: 3,
    successfulFiles: [
      createSuccessfulFile("src/a.ts", [
        createFinding("must", 92, { title: "Must finding" }),
        createFinding("nice", 95, { title: "Nice finding" })
      ]),
      createSuccessfulFile("src/c.ts", [
        createFinding("must", 89, { title: "Another must" })
      ])
    ],
    skippedFiles: [createSkippedFile(
      "src/b.ts",
      "step5-validation-interrogation",
      "deterministic validation failed"
    )]
  });

  assert.match(rendered, /^# Review Summary$/mu);
  assert.match(rendered, /- Repo root: `\/workspace\/repo`/u);
  assert.match(rendered, /- Base ref: `main`/u);
  assert.match(rendered, /- Head ref: `feature-branch`/u);
  assert.match(rendered, /- Planned files: 3/u);
  assert.match(rendered, /- Successful files: 2/u);
  assert.match(rendered, /- Skipped files: 1/u);
  assert.match(rendered, /- Final findings totals: must=2, nice=1/u);
  assert.match(rendered, /^## Risk Distribution$/mu);
  assert.match(rendered, /- High: 1/u);
  assert.match(rendered, /- Medium: 1/u);
  assert.match(rendered, /- Low: 0/u);
  assert.match(rendered, /- None: 0/u);
  assert.match(
    rendered,
    /## Successful Files[\s\S]*- \[High\] `src\/a\.ts` — must=1, nice=1[\s\S]*- \[Medium\] `src\/c\.ts` — must=1, nice=0/u
  );
  assert.match(
    rendered,
    /## Skipped Files[\s\S]*- `src\/b\.ts` — step5-validation-interrogation — deterministic validation failed/u
  );

  assertTextContainsInOrder(rendered, [
    "- Repo root: `/workspace/repo`",
    "- Base ref: `main`",
    "- Head ref: `feature-branch`",
    "- Planned files: 3",
    "- Successful files: 2",
    "- Skipped files: 1",
    "- Final findings totals: must=2, nice=1",
    "## Risk Distribution",
    "## Successful Files",
    "## Skipped Files"
  ]);
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

  assert.match(rendered, /- Planned files: 0/u);
  assert.match(rendered, /- Successful files: 0/u);
  assert.match(rendered, /- Skipped files: 0/u);
  assert.match(rendered, /- Final findings totals: must=0, nice=0/u);
  assert.match(rendered, /## Successful Files\n- 無/u);
  assert.match(rendered, /## Skipped Files\n- 無/u);
});

test("RunSummaryFinalizer treats an all-skipped run as zero-risk aggregate output", () => {
  const finalizer = new RunSummaryFinalizer();

  const rendered = finalizer.render({
    repoRoot: "/workspace/repo",
    baseRef: "main",
    headRef: "feature-branch",
    plannedFileCount: 2,
    successfulFiles: [],
    skippedFiles: [
      createSkippedFile("src/a.ts", "step1-overview", "judge rejected"),
      createSkippedFile(
        "src/b.ts",
        "step5-validation-interrogation",
        "deterministic validation failed"
      )
    ]
  });

  assert.match(rendered, /- Successful files: 0/u);
  assert.match(rendered, /- Skipped files: 2/u);
  assert.match(rendered, /- Final findings totals: must=0, nice=0/u);
  assert.match(rendered, /- High: 0/u);
  assert.match(rendered, /- Medium: 0/u);
  assert.match(rendered, /- Low: 0/u);
  assert.match(rendered, /- None: 0/u);
  assert.match(rendered, /## Successful Files\n- 無/u);
  assert.match(rendered, /- `src\/a\.ts` — step1-overview — judge rejected/u);
  assert.match(
    rendered,
    /- `src\/b\.ts` — step5-validation-interrogation — deterministic validation failed/u
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
    skippedFiles: [createSkippedFile(
      "src/b.ts",
      "step6-cognitive-simulation",
      "deterministic validation failed"
    )]
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
      createSuccessfulFile("high.ts", [createFinding("must", 90, { title: "High issue" })]),
      createSuccessfulFile("medium.ts", [createFinding("must", 89, { title: "Medium issue" })]),
      createSuccessfulFile("low.ts", [createFinding("nice", 88, { title: "Low issue" })]),
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
      createSuccessfulFile("b.ts", [createFinding("nice", 80, { title: "Low issue" })]),
      createSuccessfulFile("c.ts", [createFinding("must", 80, { title: "Medium issue" })]),
      createSuccessfulFile("d.ts", [createFinding("must", 90, { title: "High issue" })]),
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
      createSuccessfulFile("a.ts", [createFinding("nice", 85, { title: "Nice suggestion" })]),
      createSuccessfulFile("b.ts", [createFinding("nice", 83, { title: "Another nice" })]),
      createSuccessfulFile("c.ts", [createFinding("nice", 81, { title: "Yet another nice" })])
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
      createSuccessfulFile("src/app.ts", [createFinding("nice", 85, { title: "Nice suggestion" })])
    ],
    skippedFiles: []
  });

  assert.match(rendered, /- \[Low\] `src\/app\.ts` — must=0, nice=1/u);
});

function assertTextContainsInOrder(text: string, fragments: string[]): void {
  let cursor = 0;

  for (const fragment of fragments) {
    const index = text.indexOf(fragment, cursor);

    assert.ok(index >= 0, `expected fragment in order: ${fragment}`);
    cursor = index + fragment.length;
  }
}
