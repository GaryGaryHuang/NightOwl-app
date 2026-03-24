import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { LocalWorkspaceProvider } from "../../src/providers/local-workspace-provider.ts";

test("LocalWorkspaceProvider initializes the run directories and skipped.md", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "nightowl-output-"));
  const outputTarget = {
    basePath: path.join(tempDir, "review", "feature-branch_03131430"),
    filesPath: path.join(tempDir, "review", "feature-branch_03131430", "files"),
    skippedPath: path.join(
      tempDir,
      "review",
      "feature-branch_03131430",
      "skipped.md"
    ),
    summaryPath: path.join(
      tempDir,
      "review",
      "feature-branch_03131430",
      "summary.md"
    ),
    indexPath: path.join(
      tempDir,
      "review",
      "feature-branch_03131430",
      "index.md"
    ),
    manifestPath: path.join(
      tempDir,
      "review",
      "feature-branch_03131430",
      "manifest.json"
    ),
    toolAuditPath: path.join(
      tempDir,
      "review",
      "feature-branch_03131430",
      "tool-audit.jsonl"
    )
  };

  try {
    const provider = new LocalWorkspaceProvider();

    provider.initializeRun(outputTarget);

    assert.equal(existsSync(outputTarget.basePath), true);
    assert.equal(existsSync(outputTarget.filesPath), true);
    assert.equal(existsSync(outputTarget.skippedPath), true);
    assert.equal(existsSync(outputTarget.toolAuditPath), true);
    assert.equal(existsSync(outputTarget.summaryPath), false);
    assert.equal(existsSync(outputTarget.indexPath), false);
    assert.equal(existsSync(outputTarget.manifestPath), false);
    assert.equal(readFileSync(outputTarget.skippedPath, "utf8"), "");
    assert.equal(readFileSync(outputTarget.toolAuditPath, "utf8"), "");
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("LocalWorkspaceProvider publishes file review content to the target note path", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "nightowl-output-"));
  const outputTarget = {
    basePath: path.join(tempDir, "review", "feature-branch_03131430"),
    filesPath: path.join(tempDir, "review", "feature-branch_03131430", "files"),
    skippedPath: path.join(
      tempDir,
      "review",
      "feature-branch_03131430",
      "skipped.md"
    ),
    summaryPath: path.join(
      tempDir,
      "review",
      "feature-branch_03131430",
      "summary.md"
    ),
    indexPath: path.join(
      tempDir,
      "review",
      "feature-branch_03131430",
      "index.md"
    ),
    manifestPath: path.join(
      tempDir,
      "review",
      "feature-branch_03131430",
      "manifest.json"
    ),
    toolAuditPath: path.join(
      tempDir,
      "review",
      "feature-branch_03131430",
      "tool-audit.jsonl"
    )
  };
  const noteFilePath = path.join(outputTarget.filesPath, "src__app.ts.md");

  try {
    const provider = new LocalWorkspaceProvider();

    provider.initializeRun(outputTarget);
    provider.publishFileReview({
      noteFilePath,
      content: "# src/app.ts\n\nPending review.\n"
    });

    assert.equal(readFileSync(noteFilePath, "utf8"), "# src/app.ts\n\nPending review.\n");
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("LocalWorkspaceProvider appends deterministic skipped-file records to skipped.md", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "nightowl-output-"));
  const outputTarget = {
    basePath: path.join(tempDir, "review", "feature-branch_03131430"),
    filesPath: path.join(tempDir, "review", "feature-branch_03131430", "files"),
    skippedPath: path.join(
      tempDir,
      "review",
      "feature-branch_03131430",
      "skipped.md"
    ),
    summaryPath: path.join(
      tempDir,
      "review",
      "feature-branch_03131430",
      "summary.md"
    ),
    indexPath: path.join(
      tempDir,
      "review",
      "feature-branch_03131430",
      "index.md"
    ),
    manifestPath: path.join(
      tempDir,
      "review",
      "feature-branch_03131430",
      "manifest.json"
    ),
    toolAuditPath: path.join(
      tempDir,
      "review",
      "feature-branch_03131430",
      "tool-audit.jsonl"
    )
  };

  try {
    const provider = new LocalWorkspaceProvider();

    provider.initializeRun(outputTarget);
    provider.publishSkippedFile({
      filePath: "src/app.ts",
      stepId: "step5-validation-interrogation",
      reason: "deterministic validation failed"
    });
    provider.publishSkippedFile({
      filePath: "src/other.ts",
      stepId: "step7-summary",
      reason: "judge rejected"
    });

    assert.equal(
      readFileSync(outputTarget.skippedPath, "utf8"),
      [
        "- `src/app.ts` — step5-validation-interrogation — deterministic validation failed",
        "- `src/other.ts` — step7-summary — judge rejected",
        ""
      ].join("\n")
    );
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("LocalWorkspaceProvider publishes run summary content to summary.md", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "nightowl-output-"));
  const outputTarget = {
    basePath: path.join(tempDir, "review", "feature-branch_03131430"),
    filesPath: path.join(tempDir, "review", "feature-branch_03131430", "files"),
    skippedPath: path.join(
      tempDir,
      "review",
      "feature-branch_03131430",
      "skipped.md"
    ),
    summaryPath: path.join(
      tempDir,
      "review",
      "feature-branch_03131430",
      "summary.md"
    ),
    indexPath: path.join(
      tempDir,
      "review",
      "feature-branch_03131430",
      "index.md"
    ),
    manifestPath: path.join(
      tempDir,
      "review",
      "feature-branch_03131430",
      "manifest.json"
    ),
    toolAuditPath: path.join(
      tempDir,
      "review",
      "feature-branch_03131430",
      "tool-audit.jsonl"
    )
  };

  try {
    const provider = new LocalWorkspaceProvider();

    provider.initializeRun(outputTarget);
    provider.publishRunSummary({
      content: [
        "# Review Summary",
        "",
        "- Planned files: 1",
        "- Successful files: 1",
        "- Skipped files: 0"
      ].join("\n")
    });

    assert.equal(
      readFileSync(outputTarget.summaryPath, "utf8"),
      ["# Review Summary", "", "- Planned files: 1", "- Successful files: 1", "- Skipped files: 0"].join("\n")
    );
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("LocalWorkspaceProvider publishes review index content to index.md", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "nightowl-output-"));
  const outputTarget = {
    basePath: path.join(tempDir, "review", "feature-branch_03131430"),
    filesPath: path.join(tempDir, "review", "feature-branch_03131430", "files"),
    skippedPath: path.join(
      tempDir,
      "review",
      "feature-branch_03131430",
      "skipped.md"
    ),
    summaryPath: path.join(
      tempDir,
      "review",
      "feature-branch_03131430",
      "summary.md"
    ),
    indexPath: path.join(
      tempDir,
      "review",
      "feature-branch_03131430",
      "index.md"
    ),
    manifestPath: path.join(
      tempDir,
      "review",
      "feature-branch_03131430",
      "manifest.json"
    ),
    toolAuditPath: path.join(
      tempDir,
      "review",
      "feature-branch_03131430",
      "tool-audit.jsonl"
    )
  };

  try {
    const provider = new LocalWorkspaceProvider();

    provider.initializeRun(outputTarget);
    provider.publishReviewIndex({
      content: [
        "# Review Index",
        "",
        "- Planned files: 1",
        "",
        "## Run Artifacts",
        "- [summary.md](./summary.md)"
      ].join("\n")
    });

    assert.equal(
      readFileSync(outputTarget.indexPath, "utf8"),
      [
        "# Review Index",
        "",
        "- Planned files: 1",
        "",
        "## Run Artifacts",
        "- [summary.md](./summary.md)"
      ].join("\n")
    );
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("LocalWorkspaceProvider publishes run manifest content to manifest.json", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "nightowl-output-"));
  const outputTarget = {
    basePath: path.join(tempDir, "review", "feature-branch_03131430"),
    filesPath: path.join(tempDir, "review", "feature-branch_03131430", "files"),
    skippedPath: path.join(
      tempDir,
      "review",
      "feature-branch_03131430",
      "skipped.md"
    ),
    summaryPath: path.join(
      tempDir,
      "review",
      "feature-branch_03131430",
      "summary.md"
    ),
    indexPath: path.join(
      tempDir,
      "review",
      "feature-branch_03131430",
      "index.md"
    ),
    manifestPath: path.join(
      tempDir,
      "review",
      "feature-branch_03131430",
      "manifest.json"
    ),
    toolAuditPath: path.join(
      tempDir,
      "review",
      "feature-branch_03131430",
      "tool-audit.jsonl"
    )
  };

  try {
    const provider = new LocalWorkspaceProvider();

    provider.initializeRun(outputTarget);
    provider.publishRunManifest({
      content: '{\n  "schemaVersion": 1\n}'
    });

    assert.equal(
      readFileSync(outputTarget.manifestPath, "utf8"),
      '{\n  "schemaVersion": 1\n}'
    );
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("LocalWorkspaceProvider classifies path-specific successful snapshot write failures as single-file output faults when the shared files path remains healthy", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "nightowl-output-"));
  const outputTarget = {
    basePath: path.join(tempDir, "review", "feature-branch_03131430"),
    filesPath: path.join(tempDir, "review", "feature-branch_03131430", "files"),
    skippedPath: path.join(
      tempDir,
      "review",
      "feature-branch_03131430",
      "skipped.md"
    ),
    summaryPath: path.join(
      tempDir,
      "review",
      "feature-branch_03131430",
      "summary.md"
    ),
    indexPath: path.join(
      tempDir,
      "review",
      "feature-branch_03131430",
      "index.md"
    ),
    manifestPath: path.join(
      tempDir,
      "review",
      "feature-branch_03131430",
      "manifest.json"
    ),
    toolAuditPath: path.join(
      tempDir,
      "review",
      "feature-branch_03131430",
      "tool-audit.jsonl"
    )
  };

  try {
    const provider = new LocalWorkspaceProvider();
    const noteFilePath = path.join(outputTarget.filesPath, "src__app.ts.md");
    const error = Object.assign(new Error("name too long"), {
      code: "ENAMETOOLONG",
      path: noteFilePath
    });

    provider.initializeRun(outputTarget);

    assert.deepEqual(
      provider.assessSuccessfulSnapshotFailure({
        noteFilePath,
        error
      }),
      { faultScope: "single-file-output-fault" }
    );
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("LocalWorkspaceProvider classifies disk-capacity successful snapshot write failures as shared output target faults", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "nightowl-output-"));
  const outputTarget = {
    basePath: path.join(tempDir, "review", "feature-branch_03131430"),
    filesPath: path.join(tempDir, "review", "feature-branch_03131430", "files"),
    skippedPath: path.join(
      tempDir,
      "review",
      "feature-branch_03131430",
      "skipped.md"
    ),
    summaryPath: path.join(
      tempDir,
      "review",
      "feature-branch_03131430",
      "summary.md"
    ),
    indexPath: path.join(
      tempDir,
      "review",
      "feature-branch_03131430",
      "index.md"
    ),
    manifestPath: path.join(
      tempDir,
      "review",
      "feature-branch_03131430",
      "manifest.json"
    ),
    toolAuditPath: path.join(
      tempDir,
      "review",
      "feature-branch_03131430",
      "tool-audit.jsonl"
    )
  };

  try {
    const provider = new LocalWorkspaceProvider();
    const noteFilePath = path.join(outputTarget.filesPath, "src__app.ts.md");
    const error = Object.assign(new Error("disk full"), {
      code: "ENOSPC",
      path: noteFilePath
    });

    provider.initializeRun(outputTarget);

    assert.deepEqual(
      provider.assessSuccessfulSnapshotFailure({
        noteFilePath,
        error
      }),
      { faultScope: "shared-output-target-fault" }
    );
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("LocalWorkspaceProvider falls back to shared output target fault when successful snapshot classification is inconclusive", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "nightowl-output-"));
  const outputTarget = {
    basePath: path.join(tempDir, "review", "feature-branch_03131430"),
    filesPath: path.join(tempDir, "review", "feature-branch_03131430", "files"),
    skippedPath: path.join(
      tempDir,
      "review",
      "feature-branch_03131430",
      "skipped.md"
    ),
    summaryPath: path.join(
      tempDir,
      "review",
      "feature-branch_03131430",
      "summary.md"
    ),
    indexPath: path.join(
      tempDir,
      "review",
      "feature-branch_03131430",
      "index.md"
    ),
    manifestPath: path.join(
      tempDir,
      "review",
      "feature-branch_03131430",
      "manifest.json"
    ),
    toolAuditPath: path.join(
      tempDir,
      "review",
      "feature-branch_03131430",
      "tool-audit.jsonl"
    )
  };

  try {
    const provider = new LocalWorkspaceProvider();
    const noteFilePath = path.join(outputTarget.filesPath, "src__app.ts.md");

    provider.initializeRun(outputTarget);

    assert.deepEqual(
      provider.assessSuccessfulSnapshotFailure({
        noteFilePath,
        error: new Error("note write failed")
      }),
      { faultScope: "shared-output-target-fault" }
    );
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("LocalWorkspaceProvider treats shared files-path corruption as a shared output target fault", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "nightowl-output-"));
  const outputTarget = {
    basePath: path.join(tempDir, "review", "feature-branch_03131430"),
    filesPath: path.join(tempDir, "review", "feature-branch_03131430", "files"),
    skippedPath: path.join(
      tempDir,
      "review",
      "feature-branch_03131430",
      "skipped.md"
    ),
    summaryPath: path.join(
      tempDir,
      "review",
      "feature-branch_03131430",
      "summary.md"
    ),
    indexPath: path.join(
      tempDir,
      "review",
      "feature-branch_03131430",
      "index.md"
    ),
    manifestPath: path.join(
      tempDir,
      "review",
      "feature-branch_03131430",
      "manifest.json"
    ),
    toolAuditPath: path.join(
      tempDir,
      "review",
      "feature-branch_03131430",
      "tool-audit.jsonl"
    )
  };

  try {
    const provider = new LocalWorkspaceProvider();
    const noteFilePath = path.join(outputTarget.filesPath, "src__app.ts.md");
    const error = Object.assign(new Error("path collision"), {
      code: "EEXIST",
      path: outputTarget.filesPath
    });

    provider.initializeRun(outputTarget);
    rmSync(outputTarget.filesPath, { recursive: true, force: true });
    writeFileSync(outputTarget.filesPath, "not-a-directory");

    assert.deepEqual(
      provider.assessSuccessfulSnapshotFailure({
        noteFilePath,
        error
      }),
      { faultScope: "shared-output-target-fault" }
    );
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});
