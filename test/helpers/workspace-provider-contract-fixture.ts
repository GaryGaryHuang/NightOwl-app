import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { OutputTarget } from "../../src/core/review-path-resolver.ts";
import { LocalWorkspaceProvider } from "../../src/providers/local-workspace-provider.ts";

export function createWorkspaceProviderFixture() {
  const tempDir = mkdtempSync(path.join(tmpdir(), "nightowl-output-"));
  const basePath = path.join(tempDir, "review", "feature-branch_03131430");
  const outputTarget: OutputTarget = {
    basePath,
    changesetOverviewPath: path.join(basePath, "changeset-overview.md"),
    filesPath: path.join(basePath, "files"),
    skippedPath: path.join(basePath, "skipped.md"),
    summaryPath: path.join(basePath, "summary.md"),
    indexPath: path.join(basePath, "index.md"),
    manifestPath: path.join(basePath, "manifest.json"),
    toolAuditPath: path.join(basePath, "tool-audit.jsonl")
  };
  const provider = new LocalWorkspaceProvider();

  return {
    tempDir,
    outputTarget,
    provider,
    buildNoteFilePath(fileName: string) {
      return path.join(outputTarget.filesPath, fileName);
    },
    readFile(targetPath: string) {
      return readFileSync(targetPath, "utf8");
    },
    cleanup() {
      rmSync(tempDir, { force: true, recursive: true });
    }
  };
}
