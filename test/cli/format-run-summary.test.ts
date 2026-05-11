import assert from "node:assert/strict";
import test from "node:test";

import {
  formatLocalReviewRunSummary,
  LOCAL_REVIEW_RUN_HEADER
} from "../../src/cli/format-run-summary.ts";
import type { ReviewRunSummary } from "../../src/core/orchestrator.ts";
import { createRunContext } from "../../src/core/run-context.ts";
import { stubChangeMap } from "../helpers/change-map-stub.ts";

function buildMinimalRunSummary(overrides: Partial<ReviewRunSummary> = {}): ReviewRunSummary {
  const base = "/workspace/.nightowl/review/run";
  return {
    repoRoot: "/workspace/repo",
    runContext: createRunContext({ changesetOverview: stubChangeMap("## Changeset Overview"), userContext: [] }),
    outputTarget: {
      basePath: base,
      changesetOverviewPath: `${base}/changeset-overview.md`,
      filesPath: `${base}/files`,
      indexPath: `${base}/index.md`,
      toolAuditPath: `${base}/tool-audit.jsonl`
    },
    plannedFileCount: 1,
    successfulFileCount: 1,
    skippedFileCount: 0,
    dryRun: false,
    finalizerFailures: [],
    ...overrides
  };
}

test("formatLocalReviewRunSummary adds [DRY RUN] prefix to header when dryRun is true", () => {
  const result = buildMinimalRunSummary({ dryRun: true });
  const summary = formatLocalReviewRunSummary(result);

  assert.ok(
    summary.startsWith("[DRY RUN] " + LOCAL_REVIEW_RUN_HEADER),
    `Expected [DRY RUN] prefix, got: ${summary.split("\n")[0]}`
  );
});

test("formatLocalReviewRunSummary does not add [DRY RUN] prefix when dryRun is false", () => {
  const result = buildMinimalRunSummary({ dryRun: false });
  const summary = formatLocalReviewRunSummary(result);

  assert.ok(
    summary.startsWith(LOCAL_REVIEW_RUN_HEADER),
    `Expected plain header, got: ${summary.split("\n")[0]}`
  );
  assert.ok(!summary.includes("[DRY RUN]"), "Must not contain [DRY RUN] when dryRun is false");
});

test("formatLocalReviewRunSummary has no warning line when finalizerFailures is empty", () => {
  const result = buildMinimalRunSummary({ finalizerFailures: [] });
  const summary = formatLocalReviewRunSummary(result);

  assert.ok(!summary.includes("Warning:"), "Must not contain Warning when finalizerFailures is empty");
});

test("formatLocalReviewRunSummary appends warning line listing failed artifact names when finalizerFailures is non-empty", () => {
  const result = buildMinimalRunSummary({
    finalizerFailures: [
      { artifact: "index", message: "disk full" }
    ]
  });
  const summary = formatLocalReviewRunSummary(result);

  assert.match(summary, /Warning: Failed to write run-level artifacts: index/u);
});

test("formatLocalReviewRunSummary keeps only completion counts in the final CLI summary", () => {
  const result = buildMinimalRunSummary();
  const lines = formatLocalReviewRunSummary(result).split("\n");

  assert.deepEqual(lines, [
    "Review run completed.",
    "Planned files: 1",
    "Successful files: 1",
    "Skipped files: 0"
  ]);
});
