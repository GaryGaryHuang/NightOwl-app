import type { Finding } from "./file-review-context.ts";
import { DEFAULT_CONFIDENCE_THRESHOLDS } from "./confidence-thresholds.ts";

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
 * The High-risk threshold is sourced from `DEFAULT_CONFIDENCE_THRESHOLDS.nice`. This value is
 * intentionally independent of user-configurable `ReviewConfig.confidenceThresholds`: risk labels
 * express fixed quality semantics and must not drift with per-repo filtering preferences.
 *
 * The rationale for using the nice default threshold as the High-risk boundary: the nice threshold
 * represents the high-conviction bar — the same bar used to filter noise from nice-to-have
 * suggestions. Only must findings whose confidence reaches this level should escalate to the
 * strongest risk signal.
 */
export function deriveFileRiskLevel(findings: Finding[] | undefined): RiskLevel {
  if (!findings || findings.length === 0) {
    return "None";
  }

  if (
    findings.some(
      (finding) =>
        finding.type === "must" &&
        finding.confidence >= DEFAULT_CONFIDENCE_THRESHOLDS.nice
    )
  ) {
    return "High";
  }

  if (findings.some((finding) => finding.type === "must")) {
    return "Medium";
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
 * Build a deterministic risk snapshot from finalized findings.
 *
 * Delegates to `deriveFileRiskLevel()` for the risk label so the snapshot
 * is guaranteed to agree with manifests, indexes, and run summaries.
 */
export function buildRiskSnapshot(findings: Finding[] | undefined): RiskSnapshot {
  const derivedRiskLevel = deriveFileRiskLevel(findings);
  const safe = findings ?? [];
  const mustCount = safe.filter((f) => f.type === "must").length;
  const niceCount = safe.filter((f) => f.type === "nice").length;
  const acceptedFindingIds = safe.map((f) => f.findingId);

  return {
    schemaVersion: 1,
    derivedRiskLevel,
    mustCount,
    niceCount,
    acceptedFindingIds,
    retiredFindingCount: 0,
    riskBasis: buildRiskBasis(derivedRiskLevel, mustCount, niceCount)
  };
}

function buildRiskBasis(level: RiskLevel, mustCount: number, niceCount: number): string {
  switch (level) {
    case "High":
      return `High: ${mustCount} must-fix finding(s) with at least one reaching the high-confidence threshold`;
    case "Medium":
      return `Medium: ${mustCount} must-fix finding(s) present but none reaches the high-confidence threshold`;
    case "Low":
      return `Low: ${niceCount} nice-to-have suggestion(s) only, no must-fix findings`;
    case "None":
      return "None: no accepted findings";
  }
}
