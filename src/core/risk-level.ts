import type { Finding } from "./file-review-context.ts";

// Must findings at or above this threshold are promoted to High risk; below it they stay Medium.
// Intentionally matches DEFAULT_CONFIDENCE_THRESHOLDS.nice so only high-conviction must findings drive the strongest signal.
const HIGH_CONFIDENCE_THRESHOLD = 90;

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
 */
export function deriveFileRiskLevel(findings: Finding[] | undefined): RiskLevel {
  if (!findings || findings.length === 0) {
    return "None";
  }

  if (
    findings.some(
      (finding) =>
        finding.type === "must" &&
        finding.confidence >= HIGH_CONFIDENCE_THRESHOLD
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
