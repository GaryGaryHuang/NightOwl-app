import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { LocalWorkspaceProvider } from "../../src/providers/local-workspace-provider.ts";
import type {
  ReviewOutputPlan,
  ReviewOutputTarget
} from "../../src/providers/review-output-sink.ts";

export function createWorkspaceProviderFixture() {
  const tempDir = mkdtempSync(path.join(tmpdir(), "nightowl-output-"));
  const basePath = path.join(tempDir, ".nightowl", "review", "feature-branch_03131430");
  const outputTarget: ReviewOutputTarget = {
    basePath,
    changesetOverviewPath: path.join(basePath, "changeset-overview.md"),
    filesPath: path.join(basePath, "files"),
    skippedPath: path.join(basePath, "skipped.md"),
    indexPath: path.join(basePath, "index.md"),
    toolAuditPath: path.join(basePath, "tool-audit.jsonl")
  };
  const provider = new LocalWorkspaceProvider();
  const outputPlan: ReviewOutputPlan = {
    outputTarget,
    plannedNotes: []
  };

  return {
    tempDir,
    outputPlan,
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
