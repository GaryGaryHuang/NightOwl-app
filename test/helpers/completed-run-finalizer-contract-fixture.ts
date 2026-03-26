import type { Finding } from "../../src/core/file-review-context.ts";
import type {
  OutputTarget,
  PlannedNoteFile
} from "../../src/core/review-path-resolver.ts";
import type {
  SkippedFileOutcome,
  SuccessfulFileOutcome
} from "../../src/core/run-summary-finalizer.ts";

const DEFAULT_BASE_PATH = "/workspace/review/feature-branch_03131430";

export function createFinding(
  type: "must" | "nice",
  confidence: number,
  input: { title?: string; suggestion?: string } = {}
): Finding {
  return {
    type,
    title: input.title ?? `${type} finding`,
    traceability: { kind: "line-range", lineStart: 1, lineEnd: 1 },
    context: "ctx",
    deviation: "dev",
    impact: "impact",
    suggestion: input.suggestion ?? "suggestion",
    confidence
  };
}

export function createSuccessfulFile(
  filePath: string,
  findings: Finding[]
): SuccessfulFileOutcome {
  return { filePath, findings };
}

export function createSkippedFile(
  filePath: string,
  stepId: string,
  reason: string
): SkippedFileOutcome {
  return { filePath, stepId, reason };
}

export function createOutputTarget(
  overrides: Partial<OutputTarget> = {}
): OutputTarget {
  const basePath = overrides.basePath ?? DEFAULT_BASE_PATH;

  return {
    basePath,
    changesetOverviewPath:
      overrides.changesetOverviewPath ?? `${basePath}/changeset-overview.md`,
    filesPath: overrides.filesPath ?? `${basePath}/files`,
    skippedPath: overrides.skippedPath ?? `${basePath}/skipped.md`,
    summaryPath: overrides.summaryPath ?? `${basePath}/summary.md`,
    indexPath: overrides.indexPath ?? `${basePath}/index.md`,
    manifestPath: overrides.manifestPath ?? `${basePath}/manifest.json`,
    toolAuditPath: overrides.toolAuditPath ?? `${basePath}/tool-audit.jsonl`
  };
}

export function createPlannedNote(
  filePath: string,
  noteFilePath: string
): PlannedNoteFile {
  return { filePath, noteFilePath };
}

export function createPlannedNotes(
  entries: Array<[filePath: string, noteFilePath: string]>
): PlannedNoteFile[] {
  return entries.map(([filePath, noteFilePath]) =>
    createPlannedNote(filePath, noteFilePath)
  );
}
