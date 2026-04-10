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
  // Sanitize the branch-derived prefix so session IDs stay filesystem-safe and deterministic.
  const candidate = sanitizeSegment(input.branchName ?? input.headRef);
  const fallback = sanitizeSegment(input.headRef);
  const prefix = candidate || fallback || "review";

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
    manifestPath: path.join(basePath, "manifest.json"),
    toolAuditPath: path.join(basePath, "tool-audit.jsonl")
  };
}

export function planNoteFiles(
  filesPath: string,
  changedFiles: string[]
): PlannedNoteFile[] {
  // Start from the basename and prepend parent segments only as needed until every note filename is unique.
  const depths = new Map(changedFiles.map((filePath) => [filePath, 1]));

  // Termination invariant: every conflict pass increments the depth of at least one conflicting
  // path. Since path segment count is bounded above by the number of directory components in each
  // file path, the loop must terminate in at most max(depth(filePath)) passes.
  while (true) {
    // Recompute the whole mapping each pass so collision resolution stays deterministic.
    const collisions = new Map();

    for (const filePath of changedFiles) {
      const key = buildNoteFileName(filePath, depths.get(filePath) ?? 1);
      const matchingPaths = collisions.get(key) ?? [];
      matchingPaths.push(filePath);
      collisions.set(key, matchingPaths);
    }

    const conflicts = [...collisions.values()].filter((paths) => paths.length > 1);

    if (conflicts.length === 0) {
      return changedFiles.map((filePath) => ({
        filePath,
        noteFilePath: path.join(
          filesPath,
          buildNoteFileName(filePath, depths.get(filePath) ?? 1)
        )
      }));
    }

    for (const filePaths of conflicts) {
      for (const filePath of filePaths) {
        depths.set(filePath, (depths.get(filePath) ?? 1) + 1);
      }
    }
  }
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
