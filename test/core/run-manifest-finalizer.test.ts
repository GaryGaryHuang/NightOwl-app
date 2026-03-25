import assert from "node:assert/strict";
import test from "node:test";

import { RunManifestFinalizer } from "../../src/core/run-manifest-finalizer.ts";
import type { SuccessfulFileOutcome } from "../../src/core/run-summary-finalizer.ts";

test("RunManifestFinalizer renders the exact deterministic manifest contract for a mixed-result run", () => {
  const finalizer = new RunManifestFinalizer();

  const rendered = finalizer.render({
    repoRoot: "/workspace/repo",
    baseRef: "main",
    headRef: "feature-branch",
    outputTarget: {
      basePath: "/workspace/review/feature-branch_03131430",
      changesetOverviewPath: "/workspace/review/feature-branch_03131430/changeset-overview.md",
      filesPath: "/workspace/review/feature-branch_03131430/files",
      skippedPath: "/workspace/review/feature-branch_03131430/skipped.md",
      summaryPath: "/workspace/review/feature-branch_03131430/summary.md",
      indexPath: "/workspace/review/feature-branch_03131430/index.md",
      manifestPath: "/workspace/review/feature-branch_03131430/manifest.json",
      toolAuditPath: "/workspace/review/feature-branch_03131430/tool-audit.jsonl"
    },
    plannedNotes: [
      {
        filePath: "src/a.ts",
        noteFilePath: "/workspace/review/feature-branch_03131430/files/src__a.ts.md"
      },
      {
        filePath: "src/b.ts",
        noteFilePath: "/workspace/review/feature-branch_03131430/files/src__b.ts.md"
      }
    ],
    successfulFiles: [
      createSuccessfulFile("src/a.ts", [
        createFinding("must", 92, "Must finding"),
        createFinding("nice", 95, "Nice finding")
      ])
    ],
    skippedFiles: [
      {
        filePath: "src/b.ts",
        stepId: "step5-validation-interrogation",
        reason: "review timeout after retry"
      }
    ]
  });

  assert.equal(
    rendered,
    JSON.stringify(
      {
        schemaVersion: 2,
        repoRoot: "/workspace/repo",
        baseRef: "main",
        headRef: "feature-branch",
        plannedFileCount: 2,
        successfulFileCount: 1,
        skippedFileCount: 1,
        artifacts: {
          basePath: "/workspace/review/feature-branch_03131430",
          changesetOverviewPath: "/workspace/review/feature-branch_03131430/changeset-overview.md",
          filesPath: "/workspace/review/feature-branch_03131430/files",
          summaryPath: "/workspace/review/feature-branch_03131430/summary.md",
          indexPath: "/workspace/review/feature-branch_03131430/index.md",
          skippedPath: "/workspace/review/feature-branch_03131430/skipped.md",
          manifestPath: "/workspace/review/feature-branch_03131430/manifest.json",
          toolAuditPath: "/workspace/review/feature-branch_03131430/tool-audit.jsonl"
        },
        files: [
          {
            filePath: "src/a.ts",
            notePath: "/workspace/review/feature-branch_03131430/files/src__a.ts.md",
            status: "successful",
            riskLevel: "High",
            mustCount: 1,
            niceCount: 1
          },
          {
            filePath: "src/b.ts",
            notePath: "/workspace/review/feature-branch_03131430/files/src__b.ts.md",
            status: "skipped",
            failedStepId: "step5-validation-interrogation",
            reason: "review timeout after retry"
          }
        ]
      },
      null,
      2
    )
  );
});

test("RunManifestFinalizer preserves planned file order and reuses collision-resolved note paths", () => {
  const finalizer = new RunManifestFinalizer();

  const rendered = finalizer.render({
    repoRoot: "/workspace/repo",
    baseRef: "main",
    headRef: "feature-branch",
    outputTarget: {
      basePath: "/workspace/review/feature-branch_03131430",
      changesetOverviewPath: "/workspace/review/feature-branch_03131430/changeset-overview.md",
      filesPath: "/workspace/review/feature-branch_03131430/files",
      skippedPath: "/workspace/review/feature-branch_03131430/skipped.md",
      summaryPath: "/workspace/review/feature-branch_03131430/summary.md",
      indexPath: "/workspace/review/feature-branch_03131430/index.md",
      manifestPath: "/workspace/review/feature-branch_03131430/manifest.json",
      toolAuditPath: "/workspace/review/feature-branch_03131430/tool-audit.jsonl"
    },
    plannedNotes: [
      {
        filePath: "src/api/index.ts",
        noteFilePath: "/workspace/review/feature-branch_03131430/files/src__api__index.ts.md"
      },
      {
        filePath: "tests/api/index.ts",
        noteFilePath: "/workspace/review/feature-branch_03131430/files/tests__api__index.ts.md"
      },
      {
        filePath: "docs/notes.md",
        noteFilePath: "/workspace/review/feature-branch_03131430/files/docs__notes.md.md"
      }
    ],
    successfulFiles: [
      createSuccessfulFile("docs/notes.md", []),
      createSuccessfulFile("src/api/index.ts", [createFinding("must", 91, "High issue")])
    ],
    skippedFiles: [
      {
        filePath: "tests/api/index.ts",
        stepId: "step1-overview",
        reason: "judge rejected"
      }
    ]
  });

  const parsed = JSON.parse(rendered) as {
    files: Array<Record<string, string | number>>;
  };

  assert.deepEqual(
    parsed.files.map((entry) => entry.filePath),
    ["src/api/index.ts", "tests/api/index.ts", "docs/notes.md"]
  );
  assert.equal(
    parsed.files[0].notePath,
    "/workspace/review/feature-branch_03131430/files/src__api__index.ts.md"
  );
  assert.equal(
    parsed.files[1].notePath,
    "/workspace/review/feature-branch_03131430/files/tests__api__index.ts.md"
  );
  assert.equal(parsed.files[2].riskLevel, "None");
  assert.equal(parsed.files[2].mustCount, 0);
  assert.equal(parsed.files[2].niceCount, 0);
});

test("RunManifestFinalizer renders an empty files array for zero-file runs", () => {
  const finalizer = new RunManifestFinalizer();

  const rendered = finalizer.render({
    repoRoot: "/workspace/repo",
    baseRef: "main",
    headRef: "feature-branch",
    outputTarget: {
      basePath: "/workspace/review/feature-branch_03131430",
      changesetOverviewPath: "/workspace/review/feature-branch_03131430/changeset-overview.md",
      filesPath: "/workspace/review/feature-branch_03131430/files",
      skippedPath: "/workspace/review/feature-branch_03131430/skipped.md",
      summaryPath: "/workspace/review/feature-branch_03131430/summary.md",
      indexPath: "/workspace/review/feature-branch_03131430/index.md",
      manifestPath: "/workspace/review/feature-branch_03131430/manifest.json",
      toolAuditPath: "/workspace/review/feature-branch_03131430/tool-audit.jsonl"
    },
    plannedNotes: [],
    successfulFiles: [],
    skippedFiles: []
  });

  const parsed = JSON.parse(rendered) as { files: unknown[] };
  assert.deepEqual(parsed.files, []);
});

function createSuccessfulFile(
  filePath: string,
  findings: SuccessfulFileOutcome["findings"]
): SuccessfulFileOutcome {
  return { filePath, findings };
}

// ─── Task 6.1: artifacts.toolAuditPath ────────────────────────────────────────

test("RunManifestFinalizer includes toolAuditPath in artifacts at the correct path", () => {
  const finalizer = new RunManifestFinalizer();

  const rendered = finalizer.render({
    repoRoot: "/workspace/repo",
    baseRef: "main",
    headRef: "feature-branch",
    outputTarget: {
      basePath: "/workspace/review/feature-branch_03131430",
      changesetOverviewPath: "/workspace/review/feature-branch_03131430/changeset-overview.md",
      filesPath: "/workspace/review/feature-branch_03131430/files",
      skippedPath: "/workspace/review/feature-branch_03131430/skipped.md",
      summaryPath: "/workspace/review/feature-branch_03131430/summary.md",
      indexPath: "/workspace/review/feature-branch_03131430/index.md",
      manifestPath: "/workspace/review/feature-branch_03131430/manifest.json",
      toolAuditPath: "/workspace/review/feature-branch_03131430/tool-audit.jsonl"
    },
    plannedNotes: [],
    successfulFiles: [],
    skippedFiles: []
  });

  const parsed = JSON.parse(rendered) as { artifacts: Record<string, string> };
  assert.equal(
    parsed.artifacts.toolAuditPath,
    "/workspace/review/feature-branch_03131430/tool-audit.jsonl"
  );
});

function createFinding(
  type: "must" | "nice",
  confidence: number,
  title = `${type} finding`
): SuccessfulFileOutcome["findings"][number] {
  return {
    type,
    title,
    context: "ctx",
    deviation: "dev",
    impact: "impact",
    suggestion: "suggestion",
    confidence
  };
}