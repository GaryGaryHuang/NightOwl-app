/**
 * ChangeMap v1 minimal-core schema emitted by Step 0 (changeset overview).
 *
 * Validation lives in `step0-output-validator.ts`. The shape here is the
 * authoritative structural contract; any field not listed below is rejected
 * by the validator (forward-compat reservation for later milestones).
 */

export type ChangeMapStatus = "A" | "M" | "D" | "R";

export type ChangeMapCategory =
  | "feature"
  | "bugfix"
  | "refactor"
  | "config"
  | "test"
  | "docs";

export type ChangeMapBasis = "name-status" | "diff-inspected" | "file-inspected";

export interface ChangedFileEntry {
  readonly path: string;
  readonly status: ChangeMapStatus;
  readonly category: ChangeMapCategory;
  readonly basis: ChangeMapBasis;
}

export interface BehaviorChangeEntry {
  readonly description: string;
  readonly files: readonly string[];
}

export interface UnresolvedUnknownEntry {
  readonly question: string;
  readonly blocksFinding: boolean;
  readonly resolutionPath: string;
}

export interface ChangeMap {
  readonly schemaVersion: 1;
  readonly overviewMarkdown: string;
  readonly changedFiles: readonly ChangedFileEntry[];
  readonly behaviorChanges: readonly BehaviorChangeEntry[];
  readonly unresolvedUnknowns: readonly UnresolvedUnknownEntry[];
}

/**
 * Extract the set of head-side changed paths from `git diff --name-status` lines
 * as returned by `ReviewSourceProvider.getChangesetEntries()`.
 *
 * - Regular lines (`A|M|D` + `\t` + path) take the path field.
 * - Rename / copy lines (`R\d+` / `C\d+`, three tab-separated fields) take the
 *   final field (the new path), so downstream coverage checks compare against
 *   the post-change path that subsequent per-file review uses.
 * - Empty lines are ignored.
 *
 * Order is preserved; duplicates are NOT removed (validator coverage check
 * surfaces unexpected duplicates as `COVERAGE` failures).
 */
export function extractChangedPathsFromNameStatus(
  lines: readonly string[]
): readonly string[] {
  const result: string[] = [];

  for (const rawLine of lines) {
    if (!rawLine || rawLine.length === 0) {
      continue;
    }

    const fields = rawLine.split("\t");

    if (fields.length < 2) {
      continue;
    }

    // Status code is fields[0] (e.g. "M", "A", "D", "R100", "C75").
    // The head-side path is always the last field in name-status output.
    const path = fields[fields.length - 1];

    if (path.length > 0) {
      result.push(path);
    }
  }

  return result;
}
