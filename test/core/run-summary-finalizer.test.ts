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
      "## Risk Distribution",
      "- Critical: 0",
      "- High: 2",
      "- Medium: 0",
      "- Low: 0",
      "",
      "## Successful Files",
      "- [High] `src/a.ts` — must=1, nice=1",
      "- [High] `src/c.ts` — must=1, nice=0",
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
      "## Risk Distribution",
      "- Critical: 0",
      "- High: 0",
      "- Medium: 0",
      "- Low: 0",
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

test("RunSummaryFinalizer renders Risk Distribution section with per-level counts", () => {
  const finalizer = new RunSummaryFinalizer();

  const rendered = finalizer.render({
    repoRoot: "/workspace/repo",
    baseRef: "main",
    headRef: "feature-branch",
    plannedFileCount: 3,
    successfulFiles: [
      {
        filePath: "a.ts",
        findings: [
          {
            type: "must",
            title: "Critical issue",
            context: "ctx",
            deviation: "dev",
            impact: "impact",
            suggestion: "fix",
            confidence: 96
          }
        ]
      },
      {
        filePath: "b.ts",
        findings: [
          {
            type: "must",
            title: "High issue",
            context: "ctx",
            deviation: "dev",
            impact: "impact",
            suggestion: "fix",
            confidence: 80
          }
        ]
      },
      {
        filePath: "c.ts",
        findings: [
          {
            type: "must",
            title: "Another high issue",
            context: "ctx",
            deviation: "dev",
            impact: "impact",
            suggestion: "fix",
            confidence: 85
          }
        ]
      }
    ],
    skippedFiles: []
  });

  assert.match(rendered, /^## Risk Distribution$/mu);
  assert.match(rendered, /- Critical: 1/u);
  assert.match(rendered, /- High: 2/u);
  assert.match(rendered, /- Medium: 0/u);
  assert.match(rendered, /- Low: 0/u);
});

test("RunSummaryFinalizer renders Risk Distribution with all zeros for zero-file runs", () => {
  const finalizer = new RunSummaryFinalizer();

  const rendered = finalizer.render({
    repoRoot: "/workspace/repo",
    baseRef: "main",
    headRef: "feature-branch",
    plannedFileCount: 0,
    successfulFiles: [],
    skippedFiles: []
  });

  assert.match(rendered, /^## Risk Distribution$/mu);
  assert.match(rendered, /- Critical: 0/u);
  assert.match(rendered, /- High: 0/u);
  assert.match(rendered, /- Medium: 0/u);
  assert.match(rendered, /- Low: 0/u);
});

test("RunSummaryFinalizer sorts successful files by risk level with planned-order tie-breaking", () => {
  const finalizer = new RunSummaryFinalizer();

  const rendered = finalizer.render({
    repoRoot: "/workspace/repo",
    baseRef: "main",
    headRef: "feature-branch",
    plannedFileCount: 3,
    successfulFiles: [
      {
        filePath: "a.ts",
        findings: []
      },
      {
        filePath: "b.ts",
        findings: [
          {
            type: "must",
            title: "High issue",
            context: "ctx",
            deviation: "dev",
            impact: "impact",
            suggestion: "fix",
            confidence: 80
          }
        ]
      },
      {
        filePath: "c.ts",
        findings: []
      }
    ],
    skippedFiles: []
  });

  const bIdx = rendered.indexOf("- [High] `b.ts`");
  const aIdx = rendered.indexOf("- [Low] `a.ts`");
  const cIdx = rendered.indexOf("- [Low] `c.ts`");

  assert.ok(bIdx > 0, "b.ts should appear with [High] prefix");
  assert.ok(aIdx > 0, "a.ts should appear with [Low] prefix");
  assert.ok(cIdx > 0, "c.ts should appear with [Low] prefix");
  assert.ok(bIdx < aIdx, "High risk b.ts should come before Low risk a.ts");
  assert.ok(aIdx < cIdx, "a.ts should come before c.ts (planned order tie-break)");
});

test("RunSummaryFinalizer preserves planned order for same-risk-level successful files", () => {
  const finalizer = new RunSummaryFinalizer();

  const rendered = finalizer.render({
    repoRoot: "/workspace/repo",
    baseRef: "main",
    headRef: "feature-branch",
    plannedFileCount: 3,
    successfulFiles: [
      {
        filePath: "a.ts",
        findings: [
          {
            type: "nice",
            title: "Nice suggestion",
            context: "ctx",
            deviation: "dev",
            impact: "low",
            suggestion: "optional",
            confidence: 85
          }
        ]
      },
      {
        filePath: "b.ts",
        findings: [
          {
            type: "nice",
            title: "Another nice",
            context: "ctx",
            deviation: "dev",
            impact: "low",
            suggestion: "optional",
            confidence: 83
          }
        ]
      },
      {
        filePath: "c.ts",
        findings: [
          {
            type: "nice",
            title: "Yet another nice",
            context: "ctx",
            deviation: "dev",
            impact: "low",
            suggestion: "optional",
            confidence: 81
          }
        ]
      }
    ],
    skippedFiles: []
  });

  const aIdx = rendered.indexOf("- [Medium] `a.ts`");
  const bIdx = rendered.indexOf("- [Medium] `b.ts`");
  const cIdx = rendered.indexOf("- [Medium] `c.ts`");

  assert.ok(aIdx < bIdx && bIdx < cIdx, "same-risk files should preserve planned order a, b, c");
});

test("RunSummaryFinalizer renders each successful file with risk level prefix", () => {
  const finalizer = new RunSummaryFinalizer();

  const rendered = finalizer.render({
    repoRoot: "/workspace/repo",
    baseRef: "main",
    headRef: "feature-branch",
    plannedFileCount: 1,
    successfulFiles: [
      {
        filePath: "src/app.ts",
        findings: [
          {
            type: "must",
            title: "Must issue",
            context: "ctx",
            deviation: "dev",
            impact: "impact",
            suggestion: "fix",
            confidence: 80
          },
          {
            type: "nice",
            title: "Nice suggestion",
            context: "ctx",
            deviation: "dev",
            impact: "low",
            suggestion: "optional",
            confidence: 85
          }
        ]
      }
    ],
    skippedFiles: []
  });

  assert.match(rendered, /- \[High\] `src\/app\.ts` — must=1, nice=1/u);
});
