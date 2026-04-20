import type { Finding, FindingDisposition } from "./file-review-context.ts";

export type RiskLevel = "High" | "Medium" | "Low" | "None";

// Shared severity ordering for run-level outputs: strong must-fix findings rank above weaker musts, then nice-to-haves.
export const RISK_ORDER: Record<RiskLevel, number> = {
  High: 0,
  Medium: 1,
  Low: 2,
  None: 3
};

/**
 * Collapse finalized findings into the run-level risk label shown in summaries, indexes, and manifests.
 *
 * Risk semantics are intentionally independent of model-authored confidence.
 * Any accepted must-fix finding escalates the file to High; nice-only findings map to Low;
 * and no accepted findings maps to None. The Medium enum value is retained for compatibility
 * with downstream output contracts even though the current deterministic mapping does not emit it.
 */
export function deriveFileRiskLevel(findings: Finding[] | undefined): RiskLevel {
  if (!findings || findings.length === 0) {
    return "None";
  }

  if (findings.some((finding) => finding.type === "must")) {
    return "High";
  }

  if (findings.some((finding) => finding.type === "nice")) {
    return "Low";
  }

  return "None";
}

export interface RiskSnapshot {
  schemaVersion: 1;
  derivedRiskLevel: RiskLevel;
  mustCount: number;
  niceCount: number;
  acceptedFindingIds: string[];
  retiredFindingCount: number;
  riskBasis: string;
}

/**
 * Build a deterministic risk snapshot from finalized findings and dispositions.
 *
 * Delegates to `deriveFileRiskLevel()` for the risk label so the snapshot
 * is guaranteed to agree with manifests, indexes, and run summaries.
 */
export function buildRiskSnapshot(
  findings: Finding[] | undefined,
  dispositions?: FindingDisposition[]
): RiskSnapshot {
  const derivedRiskLevel = deriveFileRiskLevel(findings);
  const safe = findings ?? [];
  const safeDispositions = dispositions ?? [];
  const mustCount = safe.filter((f) => f.type === "must").length;
  const niceCount = safe.filter((f) => f.type === "nice").length;
  const acceptedFindingIds = safe.map((f) => f.findingId);
  const retiredFindingCount = safeDispositions.filter(
    (disposition) => disposition.status === "retired"
  ).length;

  return {
    schemaVersion: 1,
    derivedRiskLevel,
    mustCount,
    niceCount,
    acceptedFindingIds,
    retiredFindingCount,
    riskBasis: buildRiskBasis(
      derivedRiskLevel,
      mustCount,
      niceCount,
      retiredFindingCount
    )
  };
}

function buildRiskBasis(
  level: RiskLevel,
  mustCount: number,
  niceCount: number,
  retiredFindingCount: number
): string {
  switch (level) {
    case "High":
      return `High: ${mustCount} must-fix finding(s) remain after verification`;
    case "Medium":
      return `Medium: compatibility-only risk label; current deterministic mapping did not emit this state`;
    case "Low":
      return `Low: ${niceCount} nice-to-have finding(s) remain after verification; no must-fix findings`;
    case "None":
      return retiredFindingCount > 0
        ? `None: no accepted findings remain after verification; ${retiredFindingCount} candidate finding(s) were retired`
        : "None: no accepted findings";
  }
}
