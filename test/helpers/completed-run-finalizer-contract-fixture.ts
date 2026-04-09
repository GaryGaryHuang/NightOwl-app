import type { Finding } from "../../src/core/file-review-context.ts";
import type {
  OutputTarget,
  PlannedNoteFile
} from "../../src/core/review-path-resolver.ts";
import type { SkippedFileOutcome, SuccessfulFileOutcome } from "../../src/core/run-outcomes.ts";

// Stable fake path used as the default base for all output target fixtures;
// does not need to exist on disk since finalizer tests operate on in-memory
// structs rather than reading back written files.
const DEFAULT_BASE_PATH = "/workspace/.nightowl/review/feature-branch_03131430";

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

// Builds a complete OutputTarget from the given basePath (or DEFAULT_BASE_PATH
// if omitted), applying per-field overrides where provided. This keeps test
// setup concise: callers only specify the fields their assertion cares about.
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
