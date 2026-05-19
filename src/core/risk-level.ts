import type { Finding } from "./file-review-context.ts";

export type RiskLevel = "High" | "Low" | "None";

// Shared severity ordering for run-level outputs: must-fix findings rank above nice-to-haves, then no findings.
export const RISK_ORDER: Record<RiskLevel, number> = {
  High: 0,
  Low: 1,
  None: 2
};

export function countMustFindings(findings: Finding[] | undefined): number {
  return findings?.filter((f) => f.classification === "confirmed_problem" && f.severity === "high").length ?? 0;
}

export function countNiceFindings(findings: Finding[] | undefined): number {
  return findings?.filter((f) => !(f.classification === "confirmed_problem" && f.severity === "high")).length ?? 0;
}

/**
 * Collapse finalized findings into the priority bucket used for run-level ordering.
 *
 * Any accepted confirmed_problem/high finding escalates the file to High;
 * remaining findings (confirmed_problem/low or reasonable_risk) map to Low;
 * and no accepted findings maps to None.
 */
export function deriveFileRiskLevel(findings: Finding[] | undefined): RiskLevel {
  if (!findings || findings.length === 0) {
    return "None";
  }

  if (findings.some((f) => f.classification === "confirmed_problem" && f.severity === "high")) {
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

/**
 * Build a deterministic approved-findings snapshot from finalized findings.
 *
 * Delegates to `deriveFileRiskLevel()` for the internal priority bucket so the
 * snapshot stays aligned with summary status and run-level ordering.
 */
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
