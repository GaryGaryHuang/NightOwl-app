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
 * Collapse finalized findings into the risk label shown in review notes and the run index.
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
  riskBasis: string;
}

/**
 * Build a deterministic risk snapshot from finalized findings.
 *
 * Delegates to `deriveFileRiskLevel()` for the risk label so the snapshot
 * is guaranteed to agree with review notes and the run index summary.
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
    acceptedFindingIds,
    riskBasis: buildRiskBasis(
      derivedRiskLevel,
      mustCount,
      niceCount
    )
  };
}

function buildRiskBasis(
  level: RiskLevel,
  mustCount: number,
  niceCount: number
): string {
  switch (level) {
    case "High":
      return `High: ${mustCount} must-fix finding(s) remain after verification`;
    case "Low":
      return `Low: ${niceCount} nice-to-have finding(s) remain after verification; no must-fix findings`;
    case "None":
      return "None: no accepted findings";
  }
}
