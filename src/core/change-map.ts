import type { ReviewChangesetEntry } from "../providers/review-source-provider.ts";

/** Changeset Overview's V2 run-level contract plus host-normalized changeset descriptors. */

export const CHANGE_MAP_STATUSES = ["A", "M", "D", "R"] as const;
export type ChangeMapStatus = (typeof CHANGE_MAP_STATUSES)[number];

export interface ReadinessBehaviorChangeEntry {
  readonly description: string;
  readonly files: readonly string[];
}

export interface ReadinessUnresolvedUnknownEntry {
  readonly question: string;
  readonly resolutionPath: string;
}

export const EXPECTED_BEHAVIOR_CONFIDENCES = ["explicit", "inferred"] as const;
export type ExpectedBehaviorConfidence =
  (typeof EXPECTED_BEHAVIOR_CONFIDENCES)[number];

export interface ReviewObjective {
  readonly summary: string;
  readonly requestedFocus: readonly string[];
  readonly expectedBehaviorSummary: readonly string[];
}

export interface UserBehaviorEntry {
  readonly statement: string;
  readonly confidence: ExpectedBehaviorConfidence;
}

export interface MissingInformationEntry {
  readonly description: string;
  readonly whyItMatters: string;
}

export interface ChangeMapReadinessV2 {
  readonly reviewObjective: ReviewObjective;
  readonly userContext: readonly string[];
  readonly userBehavior: readonly UserBehaviorEntry[];
  readonly missingInformation: readonly MissingInformationEntry[];
  readonly overviewMarkdown: string;
  readonly behaviorChanges: readonly ReadinessBehaviorChangeEntry[];
  readonly unresolvedUnknowns: readonly ReadinessUnresolvedUnknownEntry[];
}

export type ChangeMapReadiness = ChangeMapReadinessV2;

export interface ExpectedChangedFileDescriptor {
  readonly originalStatus: ReviewChangesetEntry["status"];
  readonly status: ChangeMapStatus;
  readonly path: string;
  readonly previousPath?: string;
  readonly similarityScore?: number;
  readonly deleted: boolean;
  readonly copiedAsAdded: boolean;
  readonly reviewableNonDeleted: boolean;
}

export function normalizeChangesetEntriesForChangeMap(
  entries: readonly ReviewChangesetEntry[]
): readonly ExpectedChangedFileDescriptor[] {
  return entries
    .filter((entry) => entry.path.length > 0)
    .map((entry) => {
      const status = normalizeChangeMapStatus(entry.status);
      return {
        originalStatus: entry.status,
        status,
        path: entry.path,
        previousPath:
          "previousPath" in entry ? entry.previousPath : undefined,
        similarityScore:
          "similarityScore" in entry ? entry.similarityScore : undefined,
        deleted: status === "D",
        copiedAsAdded: entry.status === "C",
        reviewableNonDeleted: status !== "D"
      };
    });
}

function normalizeChangeMapStatus(
  status: ReviewChangesetEntry["status"]
): ChangeMapStatus {
  switch (status) {
    case "A":
    case "M":
    case "D":
    case "R":
      return status;
    case "C":
      return "A";
  }

  return "M";
}
