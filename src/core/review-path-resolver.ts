import path from "node:path";

import { reviewOutputRoot } from "./nightowl-namespace.ts";

export interface BuildSessionIdInput {
  branchName?: string;
  headRef: string;
  timestamp: string;
}

export interface OutputTarget {
  basePath: string;
  changesetOverviewPath: string;
  filesPath: string;
  skippedPath: string;
  summaryPath: string;
  indexPath: string;
  verifierReportPath: string;
  manifestPath: string;
  toolAuditPath: string;
}

export interface ResolveOutputTargetInput extends BuildSessionIdInput {
  repoRoot: string;
}

export interface PlannedNoteFile {
  filePath: string;
  noteFilePath: string;
}

export function buildSessionId(input: BuildSessionIdInput): string {
  const prefix =
    sanitizeSegment(input.branchName ?? "") ||
    sanitizeSegment(input.headRef) ||
    "review";

  return `${prefix}_${input.timestamp}`;
}

export function buildOutputTarget(
  input: ResolveOutputTargetInput
): OutputTarget {
  const sessionId = buildSessionId(input);
  const basePath = path.join(reviewOutputRoot(input.repoRoot), sessionId);

  return {
    basePath,
    changesetOverviewPath: path.join(basePath, "changeset-overview.md"),
    filesPath: path.join(basePath, "files"),
    skippedPath: path.join(basePath, "skipped.md"),
    summaryPath: path.join(basePath, "summary.md"),
    indexPath: path.join(basePath, "index.md"),
    verifierReportPath: path.join(basePath, "verifier-report.jsonl"),
    manifestPath: path.join(basePath, "manifest.json"),
    toolAuditPath: path.join(basePath, "tool-audit.jsonl")
  };
}

export function planNoteFiles(
  filesPath: string,
  changedFiles: string[]
): PlannedNoteFile[] {
  // Track how many parent segments to include per file, starting at 1 (basename only).
  const depths = new Map(changedFiles.map((filePath) => [filePath, 1]));

  // Iteratively widen any colliding note filenames by incrementing parent depth.
  // Terminates because each conflict pass increments depth for at least one file,
  // bounded above by the number of directory segments in that file's path.
  let conflicts = detectNoteNameConflicts(changedFiles, depths);
  while (conflicts.length > 0) {
    for (const filePaths of conflicts) {
      for (const filePath of filePaths) {
        depths.set(filePath, (depths.get(filePath) ?? 1) + 1);
      }
    }
    conflicts = detectNoteNameConflicts(changedFiles, depths);
  }

  return changedFiles.map((filePath) => ({
    filePath,
    noteFilePath: path.join(
      filesPath,
      buildNoteFileName(filePath, depths.get(filePath) ?? 1)
    )
  }));
}

function detectNoteNameConflicts(
  changedFiles: string[],
  depths: Map<string, number>
): string[][] {
  const noteNameToFiles = new Map<string, string[]>();

  for (const filePath of changedFiles) {
    const key = buildNoteFileName(filePath, depths.get(filePath) ?? 1);
    const existing = noteNameToFiles.get(key) ?? [];
    existing.push(filePath);
    noteNameToFiles.set(key, existing);
  }

  return [...noteNameToFiles.values()].filter((paths) => paths.length > 1);
}

function sanitizeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/gu, "_").replace(/_+/gu, "_");
}

function buildNoteFileName(filePath: string, parentDepth: number): string {
  const normalizedPath = filePath.replace(/\\/gu, "/");
  const segments = normalizedPath.split("/");
  const fileName = segments.at(-1);

  if (!fileName) {
    throw new Error(`Invalid changed file path: ${filePath}`);
  }

  if (segments.length === 1) {
    return `${fileName}.md`;
  }

  const availableParents = segments.slice(0, -1);
  const depth = Math.min(parentDepth, availableParents.length);
  const parentSegments = availableParents.slice(-depth);

  return `${parentSegments.join("__")}__${fileName}.md`;
}
