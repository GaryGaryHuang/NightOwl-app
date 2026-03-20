import assert from "node:assert/strict";
import test from "node:test";

import {
  RunSummaryFinalizer
} from "../../src/core/run-summary-finalizer.ts";

test("RunSummaryFinalizer renders the exact aggregate summary contract with planned-order successful and skipped files", () => {
  const finalizer = new RunSummaryFinalizer();

  const rendered = finalizer.render({
    repoRoot: "/workspace/repo",
    baseRef: "main",
    headRef: "feature-branch",
    plannedFileCount: 3,
    successfulFiles: [
      {
        filePath: "src/a.ts",
        findings: [
          {
            type: "must",
            title: "Must finding",
            context: "ctx",
            deviation: "dev",
            impact: "impact",
            suggestion: "suggestion",
            confidence: 92
          },
          {
            type: "nice",
            title: "Nice finding",
            context: "ctx",
            deviation: "dev",
            impact: "impact",
            suggestion: "suggestion",
            confidence: 95
          }
        ]
      },
      {
        filePath: "src/c.ts",
        findings: [
          {
            type: "must",
            title: "Another must",
            context: "ctx",
            deviation: "dev",
            impact: "impact",
            suggestion: "suggestion",
            confidence: 90
          }
        ]
      }
    ],
    skippedFiles: [
      {
        filePath: "src/b.ts",
        stepId: "step5-validation-interrogation",
        reason: "deterministic validation failed"
      }
    ]
  });

  assert.equal(
    rendered,
    [
      "# Review Summary",
      "",
      "- Repo root: `/workspace/repo`",
      "- Base ref: `main`",
      "- Head ref: `feature-branch`",
      "- Planned files: 3",
      "- Successful files: 2",
      "- Skipped files: 1",
      "- Final findings totals: must=2, nice=1",
      "",
      "## Successful Files",
      "- `src/a.ts` — must=1, nice=1",
      "- `src/c.ts` — must=1, nice=0",
      "",
      "## Skipped Files",
      "- `src/b.ts` — step5-validation-interrogation — deterministic validation failed"
    ].join("\n")
  );
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

  assert.equal(
    rendered,
    [
      "# Review Summary",
      "",
      "- Repo root: `/workspace/repo`",
      "- Base ref: `main`",
      "- Head ref: `feature-branch`",
      "- Planned files: 0",
      "- Successful files: 0",
      "- Skipped files: 0",
      "- Final findings totals: must=0, nice=0",
      "",
      "## Successful Files",
      "- 無",
      "",
      "## Skipped Files",
      "- 無"
    ].join("\n")
  );
});

test("RunSummaryFinalizer excludes skipped files from final findings totals", () => {
  const finalizer = new RunSummaryFinalizer();

  const rendered = finalizer.render({
    repoRoot: "/workspace/repo",
    baseRef: "main",
    headRef: "feature-branch",
    plannedFileCount: 2,
    successfulFiles: [
      {
        filePath: "src/a.ts",
        findings: [
          {
            type: "nice",
            title: "Only successful file finding",
            context: "ctx",
            deviation: "dev",
            impact: "impact",
            suggestion: "suggestion",
            confidence: 91
          }
        ]
      }
    ],
    skippedFiles: [
      {
        filePath: "src/b.ts",
        stepId: "step6-cognitive-simulation",
        reason: "deterministic validation failed"
      }
    ]
  });

  assert.match(rendered, /- Final findings totals: must=0, nice=1/u);
  assert.doesNotMatch(rendered, /must=1, nice=1/u);
});
