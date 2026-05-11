import assert from "node:assert/strict";
import test from "node:test";

import {
  renderRunSummary,
  type RunSummaryRenderInput
} from "../../../src/core/finalizers/run-summary-finalizer.ts";
import {
  createCoverageBuckets,
  createFinding,
  createPlannedNotesFromPaths,
  createResolvedOutcomes,
  createSkippedFile,
  createSuccessfulFile
} from "../../helpers/completed-run-finalizer-contract-fixture.ts";

function renderSummary(overrides: {
  plannedNotes?: ReturnType<typeof createPlannedNotesFromPaths>;
  successfulFiles?: ReturnType<typeof createSuccessfulFile>[];
  skippedFiles?: ReturnType<typeof createSkippedFile>[];
  repoRoot?: string;
  baseRef?: string;
  headRef?: string;
  coverage?: ReturnType<typeof createCoverageBuckets>;
} = {}): string {
  const plannedNotes = overrides.plannedNotes ?? [];
  const successfulFiles = overrides.successfulFiles ?? [];
  const skippedFiles = overrides.skippedFiles ?? [];

  return renderRunSummary({
    repoRoot: overrides.repoRoot ?? "/workspace/repo",
    baseRef: overrides.baseRef ?? "main",
    headRef: overrides.headRef ?? "feature-branch",
    resolvedOutcomes: createResolvedOutcomes(plannedNotes, successfulFiles, skippedFiles),
    ...(overrides.coverage === undefined ? {} : { coverage: overrides.coverage })
  } as Parameters<typeof renderRunSummary>[0]);
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
      "candidate-findings",
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
  assert.match(rendered, /- High: 2/u);
  assert.match(rendered, /- Low: 0/u);
  assert.match(rendered, /- None: 0/u);
  assert.match(
    rendered,
    /## Successful Files[\s\S]*- \[High\] `src\/a\.ts` — must=1, nice=1[\s\S]*- \[High\] `src\/c\.ts` — must=1, nice=0/u
  );
  assert.match(
    rendered,
    /## Skipped Files[\s\S]*- `src\/b\.ts` — candidate-findings — deterministic validation failed/u
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
      createSkippedFile("src/a.ts", "review-basis", "deterministic validation failed"),
      createSkippedFile(
        "src/b.ts",
        "candidate-findings",
        "deterministic validation failed"
      )
    ]
  });

  assert.match(rendered, /- Successful files: 0/u);
  assert.match(rendered, /- Skipped files: 2/u);
  assert.match(rendered, /- Final findings totals: must=0, nice=0/u);
  assert.match(rendered, /- High: 0/u);
  assert.match(rendered, /- Low: 0/u);
  assert.match(rendered, /- None: 0/u);
  assert.match(rendered, /## Successful Files\n- 無/u);
  assert.match(rendered, /- `src\/a\.ts` — review-basis — deterministic validation failed/u);
  assert.match(
    rendered,
    /- `src\/b\.ts` — candidate-findings — deterministic validation failed/u
  );
});

test("RunSummaryFinalizer excludes skipped files from final findings totals", () => {
  const rendered = renderSummary({
    plannedNotes: createPlannedNotesFromPaths(["src/a.ts", "src/b.ts"]),
    successfulFiles: [createSuccessfulFile("src/a.ts", [createFinding("nice", 91)])],
    skippedFiles: [createSkippedFile(
      "src/b.ts",
      "semantic-validation",
      "deterministic validation failed"
    )]
  });

  assert.match(rendered, /- Final findings totals: must=0, nice=1/u);
  assert.doesNotMatch(rendered, /must=1, nice=1/u);
});

test("RunSummaryFinalizer renders Risk Distribution section with High, Low, and None counts", () => {
  const rendered = renderSummary({
    plannedNotes: createPlannedNotesFromPaths(["high.ts", "another-high.ts", "low.ts", "none.ts"]),
    successfulFiles: [
      createSuccessfulFile("high.ts", [createFinding("must", 90, { title: "High issue" })]),
      createSuccessfulFile("another-high.ts", [createFinding("must", 89, { title: "Another high issue" })]),
      createSuccessfulFile("low.ts", [createFinding("nice", 88, { title: "Low issue" })]),
      createSuccessfulFile("none.ts", [])
    ]
  });

  assert.match(rendered, /^## Risk Distribution$/mu);
  assert.match(rendered, /- High: 2/u);
  assert.match(rendered, /- Low: 1/u);
  assert.match(rendered, /- None: 1/u);
});

test("RunSummaryFinalizer reports coverage and semantic limitations without inflating risk", () => {
  const rendered = renderSummary({
    coverage: createCoverageBuckets({
      totalChangedPaths: 5,
      reviewableNonDeletedPaths: 4,
      plannedReviewableNotePaths: 2,
      deletedPaths: 1,
      binaryOrNonReviewablePaths: 2,
      successfulPlannedFiles: 2,
      skippedPlannedFiles: 0,
      changedTests: ["test/app.test.ts"]
    }),
    plannedNotes: createPlannedNotesFromPaths(["src/clean.ts", "src/blocked.ts"]),
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
        semanticIterationCount: 2,
        candidateFindingCount: 1,
        approvedFindingCount: 0,
        missingInformationCount: 1,
        failedGateCounts: { evidence: 1 },
        decisionCounts: { drop: 1 }
      })
    ]
  });

  assert.match(rendered, /^## Coverage$/mu);
  assert.match(rendered, /- Total changed paths: 5/u);
  assert.match(rendered, /- Planned reviewable notes: 2/u);
  assert.match(rendered, /- Deleted paths: 1/u);
  assert.match(rendered, /- Binary\/non-reviewable paths: 2/u);
  assert.match(rendered, /- Changed tests: `test\/app\.test\.ts`/u);
  assert.match(rendered, /^## Semantic Validation$/mu);
  assert.match(rendered, /- Passed cleanly: 1/u);
  assert.match(rendered, /- Missing-information items: 1/u);
  assert.match(rendered, /- Dropped candidates: 1/u);
  assert.match(
    rendered,
    /`src\/blocked\.ts` — passed_with_limitations; approved=0; missing-information=1/u
  );
  assert.match(rendered, /- Final findings totals: must=0, nice=0/u);
  assert.match(rendered, /- None: 2/u);
});

function assertTextContainsInOrder(text: string, fragments: string[]): void {
  let cursor = 0;

  for (const fragment of fragments) {
    const index = text.indexOf(fragment, cursor);

    assert.ok(index >= 0, `expected fragment in order: ${fragment}`);
    cursor = index + fragment.length;
  }
}
