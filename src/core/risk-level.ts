import type { Finding } from "./file-review-context.ts";

export type RiskLevel = "Critical" | "High" | "Medium" | "Low";

export function deriveFileRiskLevel(findings: Finding[] | undefined): RiskLevel {
  if (!findings || findings.length === 0) {
    return "Low";
  }

  if (findings.some((f) => f.type === "must" && f.confidence >= 95)) {
    return "Critical";
  }

  if (findings.some((f) => f.type === "must")) {
    return "High";
  }

  if (findings.some((f) => f.type === "nice")) {
    return "Medium";
  }

  return "Low";
}
