import assert from "node:assert/strict";
import test from "node:test";

import { RunManifestFinalizer } from "../../src/core/run-manifest-finalizer.ts";
import {
  createFinding,
  createOutputTarget,
  createPlannedNotes,
  createSkippedFile,
  createSuccessfulFile
} from "../helpers/completed-run-finalizer-contract-fixture.ts";

test("RunManifestFinalizer renders the exact deterministic manifest contract for a mixed-result run", () => {
  const finalizer = new RunManifestFinalizer();

  const rendered = finalizer.render({
    repoRoot: "/workspace/repo",
    baseRef: "main",
    headRef: "feature-branch",
    outputTarget: createOutputTarget(),
    plannedNotes: createPlannedNotes([
      ["src/a.ts", "/workspace/review/feature-branch_03131430/files/src__a.ts.md"],
      ["src/b.ts", "/workspace/review/feature-branch_03131430/files/src__b.ts.md"]
    ]),
    successfulFiles: [
      createSuccessfulFile("src/a.ts", [
        createFinding("must", 92, { title: "Must finding" }),
        createFinding("nice", 95, { title: "Nice finding" })
      ])
    ],
    skippedFiles: [
      createSkippedFile(
        "src/b.ts",
        "step5-validation-interrogation",
        "review timeout after retry"
      )
    ]
  });

  const parsed = JSON.parse(rendered) as {
    artifacts: Record<string, string>;
    files: Array<Record<string, string | number>>;
    schemaVersion: number;
    repoRoot: string;
    baseRef: string;
    headRef: string;
    plannedFileCount: number;
    successfulFileCount: number;
    skippedFileCount: number;
  };

  assert.deepEqual(Object.keys(parsed), [
    "schemaVersion",
    "repoRoot",
    "baseRef",
    "headRef",
    "plannedFileCount",
    "successfulFileCount",
    "skippedFileCount",
    "artifacts",
    "files"
  ]);
  assert.equal(parsed.schemaVersion, 2);
  assert.equal(parsed.repoRoot, "/workspace/repo");
  assert.equal(parsed.baseRef, "main");
  assert.equal(parsed.headRef, "feature-branch");
  assert.equal(parsed.plannedFileCount, 2);
  assert.equal(parsed.successfulFileCount, 1);
  assert.equal(parsed.skippedFileCount, 1);
  assert.deepEqual(Object.keys(parsed.artifacts), [
    "basePath",
    "changesetOverviewPath",
    "filesPath",
    "summaryPath",
    "indexPath",
    "skippedPath",
    "manifestPath",
    "toolAuditPath"
  ]);
  assert.equal(
    parsed.artifacts.manifestPath,
    "/workspace/review/feature-branch_03131430/manifest.json"
  );
  assert.equal(
    parsed.artifacts.changesetOverviewPath,
    "/workspace/review/feature-branch_03131430/changeset-overview.md"
  );
  assert.equal(
    parsed.artifacts.toolAuditPath,
    "/workspace/review/feature-branch_03131430/tool-audit.jsonl"
  );
  assert.deepEqual(parsed.files, [
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
  ]);
});

test("RunManifestFinalizer preserves planned file order and reuses collision-resolved note paths", () => {
  const finalizer = new RunManifestFinalizer();

  const rendered = finalizer.render({
    repoRoot: "/workspace/repo",
    baseRef: "main",
    headRef: "feature-branch",
    outputTarget: createOutputTarget(),
    plannedNotes: createPlannedNotes([
      ["src/api/index.ts", "/workspace/review/feature-branch_03131430/files/src__api__index.ts.md"],
      ["tests/api/index.ts", "/workspace/review/feature-branch_03131430/files/tests__api__index.ts.md"],
      ["docs/notes.md", "/workspace/review/feature-branch_03131430/files/docs__notes.md.md"]
    ]),
    successfulFiles: [
      createSuccessfulFile("docs/notes.md", []),
      createSuccessfulFile("src/api/index.ts", [
        createFinding("must", 91, { title: "High issue" })
      ])
    ],
    skippedFiles: [createSkippedFile("tests/api/index.ts", "step1-overview", "judge rejected")]
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
    outputTarget: createOutputTarget(),
    plannedNotes: [],
    successfulFiles: [],
    skippedFiles: []
  });

  const parsed = JSON.parse(rendered) as { files: unknown[] };
  assert.deepEqual(parsed.files, []);
});

test("RunManifestFinalizer includes toolAuditPath in artifacts at the correct path", () => {
  const finalizer = new RunManifestFinalizer();

  const rendered = finalizer.render({
    repoRoot: "/workspace/repo",
    baseRef: "main",
    headRef: "feature-branch",
    outputTarget: createOutputTarget(),
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
