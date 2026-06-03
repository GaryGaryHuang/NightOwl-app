import path from "node:path";

import { reviewOutputRoot } from "./nightowl-namespace.ts";

interface BuildSessionIdInput {
  headRef: string;
  timestamp: string;
}

export interface OutputTarget {
  basePath: string;
  changesetOverviewPath: string;
  filesPath: string;
  indexPath: string;
  toolAuditPath: string;
}

export interface ResolveOutputTargetInput {
  repoRoot: string;
  headRef: string;
  timestamp: string;
}

export interface PlannedNoteFile {
  filePath: string;
  noteFilePath: string;
}

function buildSessionId(input: BuildSessionIdInput): string {
  const prefix = sanitizeSegment(input.headRef) || "review";

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
    indexPath: path.join(basePath, "index.md"),
    toolAuditPath: path.join(basePath, "tool-audit.jsonl")
  };
}

export function planNoteFiles(
  filesPath: string,
  changedFiles: string[]
): PlannedNoteFile[] {
  const duplicatePath = findDuplicateChangedFile(changedFiles);
  if (duplicatePath !== undefined) {
    throw new Error(`Duplicate changed file path: ${duplicatePath}`);
  }

  // Track how many parent segments to include per file, starting at 1 (basename only).
  const depths = new Map(changedFiles.map((filePath) => [filePath, 1]));

  // Iteratively widen any colliding note filenames by incrementing parent depth.
  // Terminates because each conflict pass increments depth for at least one file,
  // bounded above by the number of directory segments in that file's path.
  // Safety bound: maximum possible iterations equals the deepest directory depth
  // among all changed files, since each pass increases depth by at least 1.
  const maxIterations = changedFiles.reduce((max, filePath) => {
    const segmentCount = filePath.replace(/\\/gu, "/").split("/").length;
    return segmentCount > max ? segmentCount : max;
  }, 1);

  let iterations = 0;
  let conflicts = detectNoteNameConflicts(changedFiles, depths);
  while (conflicts.length > 0) {
    if (++iterations > maxIterations) {
      throw new Error(
        "planNoteFiles: conflict resolution exceeded maximum iterations — possible duplicate entries in changedFiles"
      );
    }
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

function findDuplicateChangedFile(changedFiles: string[]): string | undefined {
  const seen = new Set<string>();
  for (const filePath of changedFiles) {
    if (seen.has(filePath)) {
      return filePath;
    }
    seen.add(filePath);
  }
  return undefined;
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
