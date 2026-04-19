import assert from "node:assert/strict";
import test from "node:test";

import {
  MANIFEST_SCHEMA_VERSION,
  RunManifestFinalizer
} from "../../../src/core/finalizers/run-manifest-finalizer.ts";
import type {
  ManifestSchema,
  RunManifestRenderInput,
  SuccessfulFileEntry
} from "../../../src/core/finalizers/run-manifest-finalizer.ts";
import {
  createFinding,
  createOutputTarget,
  createPlannedNotes,
  createSkippedFile,
  createSuccessfulFile
} from "../../helpers/completed-run-finalizer-contract-fixture.ts";

function renderManifest(
  overrides: Partial<RunManifestRenderInput> = {}
): ManifestSchema {
  const rendered = new RunManifestFinalizer().render({
    repoRoot: "/workspace/repo",
    baseRef: "main",
    headRef: "feature-branch",
    outputTarget: createOutputTarget(),
    plannedNotes: [],
    successfulFiles: [],
    skippedFiles: [],
    ...overrides
  });

  return JSON.parse(rendered) as ManifestSchema;
}

test("RunManifestFinalizer renders the exact deterministic manifest contract for a mixed-result run", () => {
  const parsed = renderManifest({
    plannedNotes: createPlannedNotes([
      ["src/a.ts", "/workspace/.nightowl/review/feature-branch_03131430/files/src__a.ts.md"],
      ["src/b.ts", "/workspace/.nightowl/review/feature-branch_03131430/files/src__b.ts.md"]
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
  assert.equal(parsed.schemaVersion, MANIFEST_SCHEMA_VERSION);
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
    "verifierReportPath",
    "manifestPath",
    "toolAuditPath"
  ]);
  assert.equal(
    parsed.artifacts.verifierReportPath,
    "/workspace/.nightowl/review/feature-branch_03131430/verifier-report.jsonl"
  );
  assert.equal(
    parsed.artifacts.manifestPath,
    "/workspace/.nightowl/review/feature-branch_03131430/manifest.json"
  );
  assert.equal(
    parsed.artifacts.changesetOverviewPath,
    "/workspace/.nightowl/review/feature-branch_03131430/changeset-overview.md"
  );
  assert.equal(
    parsed.artifacts.toolAuditPath,
    "/workspace/.nightowl/review/feature-branch_03131430/tool-audit.jsonl"
  );
  assert.deepEqual(parsed.files, [
    {
      filePath: "src/a.ts",
      notePath: "/workspace/.nightowl/review/feature-branch_03131430/files/src__a.ts.md",
      status: "successful",
      riskLevel: "High",
      mustCount: 1,
      niceCount: 1
    },
    {
      filePath: "src/b.ts",
      notePath: "/workspace/.nightowl/review/feature-branch_03131430/files/src__b.ts.md",
      status: "skipped",
      failedStepId: "step5-validation-interrogation",
      reason: "review timeout after retry"
    }
  ]);
});

test("RunManifestFinalizer preserves planned file order and reuses collision-resolved note paths", () => {
  const parsed = renderManifest({
    plannedNotes: createPlannedNotes([
      ["src/api/index.ts", "/workspace/.nightowl/review/feature-branch_03131430/files/src__api__index.ts.md"],
      ["tests/api/index.ts", "/workspace/.nightowl/review/feature-branch_03131430/files/tests__api__index.ts.md"],
      ["docs/notes.md", "/workspace/.nightowl/review/feature-branch_03131430/files/docs__notes.md.md"]
    ]),
    successfulFiles: [
      createSuccessfulFile("docs/notes.md", []),
      createSuccessfulFile("src/api/index.ts", [
        createFinding("must", 91, { title: "High issue" })
      ])
    ],
    skippedFiles: [
      createSkippedFile("tests/api/index.ts", "step1-overview", "judge rejected")
    ]
  });

  assert.deepEqual(
    parsed.files.map((entry) => entry.filePath),
    ["src/api/index.ts", "tests/api/index.ts", "docs/notes.md"]
  );
  assert.equal(
    parsed.files[0].notePath,
    "/workspace/.nightowl/review/feature-branch_03131430/files/src__api__index.ts.md"
  );
  assert.equal(
    parsed.files[1].notePath,
    "/workspace/.nightowl/review/feature-branch_03131430/files/tests__api__index.ts.md"
  );
  assert.equal((parsed.files[2] as SuccessfulFileEntry).riskLevel, "None");
  assert.equal((parsed.files[2] as SuccessfulFileEntry).mustCount, 0);
  assert.equal((parsed.files[2] as SuccessfulFileEntry).niceCount, 0);
});

test("RunManifestFinalizer renders an empty files array for zero-file runs", () => {
  assert.deepEqual(renderManifest().files, []);
});

test("RunManifestFinalizer uses schema version 3", () => {
  assert.equal(renderManifest().schemaVersion, 3);
});

test("RunManifestFinalizer throws with an identifying message when a planned file is absent from both outcome sets", () => {
  assert.throws(
    () =>
      renderManifest({
        plannedNotes: createPlannedNotes([
          [
            "src/missing.ts",
            "/workspace/.nightowl/review/feature-branch_03131430/files/src__missing.ts.md"
          ]
        ])
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(
        error.message,
        "Missing finalized outcome for planned file: src/missing.ts"
      );
      return true;
    }
  );
});
