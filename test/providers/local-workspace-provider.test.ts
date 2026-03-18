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
    )
  };

  try {
    const provider = new LocalWorkspaceProvider();

    provider.initializeRun(outputTarget);

    assert.equal(existsSync(outputTarget.basePath), true);
    assert.equal(existsSync(outputTarget.filesPath), true);
    assert.equal(existsSync(outputTarget.skippedPath), true);
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
