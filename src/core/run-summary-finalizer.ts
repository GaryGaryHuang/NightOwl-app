import type { Finding } from "./file-review-context.ts";
import { deriveFileRiskLevel, type RiskLevel } from "./risk-level.ts";

export interface SuccessfulFileOutcome {
  filePath: string;
  findings: Finding[];
}

export interface SkippedFileOutcome {
  filePath: string;
  stepId: string;
  reason: string;
}

export interface RunSummaryRenderInput {
  repoRoot: string;
  baseRef: string;
  headRef: string;
  plannedFileCount: number;
  successfulFiles: SuccessfulFileOutcome[];
  skippedFiles: SkippedFileOutcome[];
}

const RISK_ORDER: Record<RiskLevel, number> = {
  Critical: 0,
  High: 1,
  Medium: 2,
  Low: 3
};

export class RunSummaryFinalizer {
  render(input: RunSummaryRenderInput): string {
    const totalMust = input.successfulFiles.reduce(
      (count, file) =>
        count +
        file.findings.filter((finding) => finding.type === "must").length,
      0
    );
    const totalNice = input.successfulFiles.reduce(
      (count, file) =>
        count +
        file.findings.filter((finding) => finding.type === "nice").length,
      0
    );

    const criticalCount = input.successfulFiles.filter(
      (f) => deriveFileRiskLevel(f.findings) === "Critical"
    ).length;
    const highCount = input.successfulFiles.filter(
      (f) => deriveFileRiskLevel(f.findings) === "High"
    ).length;
    const mediumCount = input.successfulFiles.filter(
      (f) => deriveFileRiskLevel(f.findings) === "Medium"
    ).length;
    const lowCount = input.successfulFiles.filter(
      (f) => deriveFileRiskLevel(f.findings) === "Low"
    ).length;

    const sortedSuccessfulFiles = [...input.successfulFiles].sort(
      (a, b) =>
        RISK_ORDER[deriveFileRiskLevel(a.findings)] -
        RISK_ORDER[deriveFileRiskLevel(b.findings)]
    );

    const successfulLines =
      sortedSuccessfulFiles.length === 0
        ? ["- 無"]
        : sortedSuccessfulFiles.map((file) => {
            const risk = deriveFileRiskLevel(file.findings);
            const mustCount = file.findings.filter(
              (finding) => finding.type === "must"
            ).length;
            const niceCount = file.findings.filter(
              (finding) => finding.type === "nice"
            ).length;

            return `- [${risk}] \`${file.filePath}\` — must=${mustCount}, nice=${niceCount}`;
          });
    const skippedLines =
      input.skippedFiles.length === 0
        ? ["- 無"]
        : input.skippedFiles.map(
            (file) => `- \`${file.filePath}\` — ${file.stepId} — ${file.reason}`
          );

    return [
      "# Review Summary",
      "",
      `- Repo root: \`${input.repoRoot}\``,
      `- Base ref: \`${input.baseRef}\``,
      `- Head ref: \`${input.headRef}\``,
      `- Planned files: ${input.plannedFileCount}`,
      `- Successful files: ${input.successfulFiles.length}`,
      `- Skipped files: ${input.skippedFiles.length}`,
      `- Final findings totals: must=${totalMust}, nice=${totalNice}`,
      "",
      "## Risk Distribution",
      `- Critical: ${criticalCount}`,
      `- High: ${highCount}`,
      `- Medium: ${mediumCount}`,
      `- Low: ${lowCount}`,
      "",
      "## Successful Files",
      ...successfulLines,
      "",
      "## Skipped Files",
      ...skippedLines
    ].join("\n");
  }
}
