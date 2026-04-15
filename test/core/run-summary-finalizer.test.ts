import assert from "node:assert/strict";
import test from "node:test";

import {
  RunSummaryFinalizer,
  type RunSummaryRenderInput
} from "../../src/core/run-summary-finalizer.ts";
import {
  createFinding,
  createPlannedNotesFromPaths,
  createSkippedFile,
  createSuccessfulFile
} from "../helpers/completed-run-finalizer-contract-fixture.ts";

function renderSummary(overrides: Partial<RunSummaryRenderInput> = {}): string {
  return new RunSummaryFinalizer().render({
    repoRoot: "/workspace/repo",
    baseRef: "main",
    headRef: "feature-branch",
    plannedNotes: [],
    successfulFiles: [],
    skippedFiles: [],
    ...overrides
  });
}

test("RunSummaryFinalizer renders the exact aggregate summary contract with rebased derived risk levels", () => {
  const rendered = renderSummary({
    plannedNotes: createPlannedNotesFromPaths(["src/a.ts", "src/b.ts", "src/c.ts"]),
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
  const rendered = renderSummary();

  assert.match(rendered, /- Planned files: 0/u);
  assert.match(rendered, /- Successful files: 0/u);
  assert.match(rendered, /- Skipped files: 0/u);
  assert.match(rendered, /- Final findings totals: must=0, nice=0/u);
  assert.match(rendered, /## Successful Files\n- 無/u);
  assert.match(rendered, /## Skipped Files\n- 無/u);
});

test("RunSummaryFinalizer treats an all-skipped run as zero-risk aggregate output", () => {
  const rendered = renderSummary({
    plannedNotes: createPlannedNotesFromPaths(["src/a.ts", "src/b.ts"]),
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
  const rendered = renderSummary({
    plannedNotes: createPlannedNotesFromPaths(["src/a.ts", "src/b.ts"]),
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
  const rendered = renderSummary({
    plannedNotes: createPlannedNotesFromPaths(["high.ts", "medium.ts", "low.ts", "none.ts"]),
    successfulFiles: [
      createSuccessfulFile("high.ts", [createFinding("must", 90, { title: "High issue" })]),
      createSuccessfulFile("medium.ts", [createFinding("must", 89, { title: "Medium issue" })]),
      createSuccessfulFile("low.ts", [createFinding("nice", 88, { title: "Low issue" })]),
      createSuccessfulFile("none.ts", [])
    ]
  });

  assert.match(rendered, /^## Risk Distribution$/mu);
  assert.match(rendered, /- High: 1/u);
  assert.match(rendered, /- Medium: 1/u);
  assert.match(rendered, /- Low: 1/u);
  assert.match(rendered, /- None: 1/u);
});

test("RunSummaryFinalizer sorts successful files by risk level with planned-order tie-breaking", () => {
  const rendered = renderSummary({
    plannedNotes: createPlannedNotesFromPaths(["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"]),
    successfulFiles: [
      createSuccessfulFile("a.ts", []),
      createSuccessfulFile("b.ts", [createFinding("nice", 80, { title: "Low issue" })]),
      createSuccessfulFile("c.ts", [createFinding("must", 80, { title: "Medium issue" })]),
      createSuccessfulFile("d.ts", [createFinding("must", 90, { title: "High issue" })]),
      createSuccessfulFile("e.ts", [])
    ]
  });

  assertTextContainsInOrder(rendered, [
    "- [High] `d.ts` — must=1, nice=0",
    "- [Medium] `c.ts` — must=1, nice=0",
    "- [Low] `b.ts` — must=0, nice=1",
    "- [None] `a.ts` — must=0, nice=0",
    "- [None] `e.ts` — must=0, nice=0"
  ]);
});

test("RunSummaryFinalizer preserves planned order for same-risk-level successful files", () => {
  const rendered = renderSummary({
    plannedNotes: createPlannedNotesFromPaths(["a.ts", "b.ts", "c.ts"]),
    successfulFiles: [
      createSuccessfulFile("a.ts", [createFinding("nice", 85, { title: "Nice suggestion" })]),
      createSuccessfulFile("b.ts", [createFinding("nice", 83, { title: "Another nice" })]),
      createSuccessfulFile("c.ts", [createFinding("nice", 81, { title: "Yet another nice" })])
    ]
  });

  assertTextContainsInOrder(rendered, [
    "- [Low] `a.ts`",
    "- [Low] `b.ts`",
    "- [Low] `c.ts`"
  ]);
});

function assertTextContainsInOrder(text: string, fragments: string[]): void {
  let cursor = 0;

  for (const fragment of fragments) {
    const index = text.indexOf(fragment, cursor);

    assert.ok(index >= 0, `expected fragment in order: ${fragment}`);
    cursor = index + fragment.length;
  }
}
