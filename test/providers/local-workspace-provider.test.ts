import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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
    )
  };

  try {
    const provider = new LocalWorkspaceProvider();

    provider.initializeRun(outputTarget);

    assert.equal(existsSync(outputTarget.basePath), true);
    assert.equal(existsSync(outputTarget.filesPath), true);
    assert.equal(existsSync(outputTarget.skippedPath), true);
    assert.equal(existsSync(outputTarget.summaryPath), false);
    assert.equal(readFileSync(outputTarget.skippedPath, "utf8"), "");
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
