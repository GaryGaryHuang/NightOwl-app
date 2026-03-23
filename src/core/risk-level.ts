import type { Finding } from "./file-review-context.ts";

const HIGH_CONFIDENCE_THRESHOLD = 90;

export type RiskLevel = "High" | "Medium" | "Low" | "None";

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
