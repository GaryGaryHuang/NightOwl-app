/**
 * ChangeMap v1 schema emitted by Step 0 (changeset overview).
 *
 * Validation lives in `step0-output-validator.ts`. The shape here is the
 * authoritative structured run-level contract for downstream review.
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

export type ChangeMapRelationship =
  | "calls"
  | "imports"
  | "configures"
  | "tests"
  | "unknown";

export type ChangeMapEvidenceSourceKind =
  | "changed-files"
  | "diff"
  | "file"
  | "user-context"
  | "url";

export interface ChangedFileEntry {
  readonly path: string;
  readonly status: ChangeMapStatus;
  readonly category: ChangeMapCategory;
  readonly group: string;
  readonly basis: ChangeMapBasis;
}

export interface FileGroupEntry {
  readonly id: string;
  readonly label: string;
  readonly files: readonly string[];
  readonly observedChange: string;
}

export interface CrossFileBoundaryEntry {
  readonly from: string;
  readonly to: string;
  readonly relationship: ChangeMapRelationship;
  readonly evidenceRefs: readonly string[];
}

export interface TestCoverageObservationEntry {
  readonly sourceFile: string;
  readonly testFile: string;
  readonly observedExpectation: string;
  readonly evidenceRefs: readonly string[];
}

export interface EvidenceRefEntry {
  readonly id: string;
  readonly sourceKind: ChangeMapEvidenceSourceKind;
  readonly pathOrUrl: string;
  readonly anchor: string;
  readonly summary: string;
}

export interface BehaviorChangeEntry {
  readonly description: string;
  readonly files: readonly string[];
  readonly evidenceRefs: readonly string[];
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
  readonly fileGroups: readonly FileGroupEntry[];
  readonly crossFileBoundaries: readonly CrossFileBoundaryEntry[];
  readonly testCoverageObservations: readonly TestCoverageObservationEntry[];
  readonly behaviorChanges: readonly BehaviorChangeEntry[];
  readonly evidenceRefs: readonly EvidenceRefEntry[];
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
