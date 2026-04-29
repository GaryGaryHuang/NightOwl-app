import type { ReviewChangesetEntry } from "../providers/review-source-provider.ts";

/**
 * ChangeMap v1 schema emitted by Step 0 (changeset overview).
 *
 * Validation lives in `step0-output-validator.ts`. The shape here is the
 * authoritative structured run-level contract for downstream review.
 */

export const CHANGE_MAP_STATUSES = ["A", "M", "D", "R"] as const;
export type ChangeMapStatus = (typeof CHANGE_MAP_STATUSES)[number];

export const CHANGE_MAP_CATEGORIES = [
  "feature",
  "bugfix",
  "refactor",
  "config",
  "test",
  "docs"
] as const;
export type ChangeMapCategory = (typeof CHANGE_MAP_CATEGORIES)[number];

export const CHANGE_MAP_BASES = [
  "name-status",
  "diff-inspected",
  "file-inspected"
] as const;
export type ChangeMapBasis = (typeof CHANGE_MAP_BASES)[number];

export const CHANGE_MAP_RELATIONSHIPS = [
  "calls",
  "imports",
  "configures",
  "tests",
  "unknown"
] as const;
export type ChangeMapRelationship = (typeof CHANGE_MAP_RELATIONSHIPS)[number];

export const CHANGE_MAP_EVIDENCE_SOURCE_KINDS = [
  "changed-files",
  "diff",
  "file",
  "user-context",
  "url"
] as const;
export type ChangeMapEvidenceSourceKind =
  (typeof CHANGE_MAP_EVIDENCE_SOURCE_KINDS)[number];

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
 * Extract the set of head-side changed paths from provider-normalized changeset
 * entries. Rename / copy entries already expose the head-side path through
 * `path`, so downstream coverage checks compare against the same post-change
 * path that per-file review uses.
 *
 * Order is preserved; duplicates are NOT removed, because validator coverage
 * checks surface unexpected duplicates as `COVERAGE` failures.
 */
export function extractChangedPathsFromChangesetEntries(
  entries: readonly ReviewChangesetEntry[]
): readonly string[] {
  const result: string[] = [];

  for (const entry of entries) {
    if (entry.path.length > 0) {
      result.push(entry.path);
    }
  }

  return result;
}
