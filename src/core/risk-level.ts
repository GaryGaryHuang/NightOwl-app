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
