import type { Finding } from "./file-review-context.ts";

export type RiskLevel = "High" | "Low" | "None";

export function countMustFindings(findings: Finding[] | undefined): number {
  return findings?.filter((f) => f.priority === "must_fix").length ?? 0;
}

export function countNiceFindings(findings: Finding[] | undefined): number {
  return findings?.filter((f) => f.priority === "nice_to_have").length ?? 0;
}

/**
 * Collapse finalized findings into the priority bucket used for run-level ordering.
 *
 * Any accepted must_fix finding escalates the file to High;
 * nice_to_have findings map to Low;
 * and no accepted findings maps to None.
 */
function deriveFileRiskLevel(findings: Finding[] | undefined): RiskLevel {
  if (!findings || findings.length === 0) {
    return "None";
  }

  if (findings.some((f) => f.priority === "must_fix")) {
    return "High";
  }

  return "Low";
}

export interface RiskSnapshot {
  schemaVersion: 1;
  derivedRiskLevel: RiskLevel;
  mustCount: number;
  niceCount: number;
  acceptedFindingIds: string[];
}

export function buildRiskSnapshot(findings: Finding[] | undefined): RiskSnapshot {
  const derivedRiskLevel = deriveFileRiskLevel(findings);
  const safe = findings ?? [];
  const mustCount = countMustFindings(findings);
  const niceCount = countNiceFindings(findings);
  const acceptedFindingIds = safe.map((f) => f.findingId);

  return {
    schemaVersion: 1,
    derivedRiskLevel,
    mustCount,
    niceCount,
    acceptedFindingIds
  };
}
