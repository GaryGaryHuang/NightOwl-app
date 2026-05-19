import assert from "node:assert/strict";
import test from "node:test";

import {
  renderRunSummarySection
} from "../../../src/core/finalizers/run-summary-section.ts";
import {
  createFinding,
  createPlannedNotesFromPaths,
  createResolvedOutcomes,
  createSkippedFile,
  createSuccessfulFile
} from "../../helpers/completed-run-finalizer-contract-fixture.ts";

function renderSummarySection(overrides: {
  plannedNotes?: ReturnType<typeof createPlannedNotesFromPaths>;
  successfulFiles?: ReturnType<typeof createSuccessfulFile>[];
  skippedFiles?: ReturnType<typeof createSkippedFile>[];
} = {}): string {
  const plannedNotes = overrides.plannedNotes ?? [];
  const successfulFiles = overrides.successfulFiles ?? [];
  const skippedFiles = overrides.skippedFiles ?? [];

  return renderRunSummarySection({
    resolvedOutcomes: createResolvedOutcomes(plannedNotes, successfulFiles, skippedFiles)
  });
}

test("RunSummarySection renders the aggregate summary section with rebased derived risk levels", () => {
  const rendered = renderSummarySection({
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

  assert.match(rendered, /^## Run Summary$/mu);
  assert.match(rendered, /- Final findings totals: must=2, nice=1/u);
  assert.match(
    rendered,
    /### Successful Files[\s\S]*- \[High\] `src\/a\.ts` - must=1, nice=1[\s\S]*- \[High\] `src\/c\.ts` - must=1, nice=0/u
  );
  assert.match(
    rendered,
    /### Skipped Files[\s\S]*- `src\/b\.ts` - candidate-findings - deterministic validation failed/u
  );
  assertTextContainsInOrder(rendered, [
    "## Run Summary",
    "- Final findings totals: must=2, nice=1",
    "### Successful Files",
    "### Skipped Files"
  ]);
});

test("RunSummarySection renders explicit empty sections for zero-file runs", () => {
  const rendered = renderSummarySection();

  assert.match(rendered, /- Final findings totals: must=0, nice=0/u);
  assert.match(rendered, /### Successful Files\n- 無/u);
  assert.match(rendered, /### Skipped Files\n- 無/u);
});

test("RunSummarySection treats an all-skipped run as zero-risk aggregate output", () => {
  const rendered = renderSummarySection({
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

  assert.match(rendered, /- Final findings totals: must=0, nice=0/u);
  assert.match(rendered, /### Successful Files\n- 無/u);
  assert.match(rendered, /- `src\/a\.ts` - review-basis - deterministic validation failed/u);
  assert.match(
    rendered,
    /- `src\/b\.ts` - candidate-findings - deterministic validation failed/u
  );
});

test("RunSummarySection excludes skipped files from final findings totals", () => {
  const rendered = renderSummarySection({
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

test("RunSummarySection keeps successful files ordered by derived risk levels", () => {
  const rendered = renderSummarySection({
    plannedNotes: createPlannedNotesFromPaths(["high.ts", "another-high.ts", "low.ts", "none.ts"]),
    successfulFiles: [
      createSuccessfulFile("high.ts", [createFinding("must", 90, { title: "High issue" })]),
      createSuccessfulFile("another-high.ts", [createFinding("must", 89, { title: "Another high issue" })]),
      createSuccessfulFile("low.ts", [createFinding("nice", 88, { title: "Low issue" })]),
      createSuccessfulFile("none.ts", [])
    ]
  });

  assert.match(
    rendered,
    /### Successful Files[\s\S]*- \[High\] `high\.ts` - must=1, nice=0[\s\S]*- \[High\] `another-high\.ts` - must=1, nice=0[\s\S]*- \[Low\] `low\.ts` - must=0, nice=1[\s\S]*- \[None\] `none\.ts` - must=0, nice=0/u
  );
});

test("RunSummarySection keeps successful files output stable when semantic limitations exist", () => {
  const rendered = renderSummarySection({
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

  assert.match(rendered, /- Final findings totals: must=0, nice=0/u);
  assert.match(
    rendered,
    /### Successful Files[\s\S]*- \[None\] `src\/clean\.ts` - must=0, nice=0[\s\S]*- \[None\] `src\/blocked\.ts` - must=0, nice=0/u
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
