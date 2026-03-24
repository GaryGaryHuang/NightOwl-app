import type { Finding } from "./file-review-context.ts";
import { deriveFileRiskLevel, RISK_ORDER, type RiskLevel } from "./risk-level.ts";

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

    const successfulFilesWithRisk = input.successfulFiles.map((file) => ({
      file,
      risk: deriveFileRiskLevel(file.findings)
    }));
    const riskCounts: Record<RiskLevel, number> = {
      High: 0,
      Medium: 0,
      Low: 0,
      None: 0
    };

    for (const { risk } of successfulFilesWithRisk) {
      riskCounts[risk] += 1;
    }

    const sortedSuccessfulFiles = [...successfulFilesWithRisk].sort(
      (a, b) => RISK_ORDER[a.risk] - RISK_ORDER[b.risk]
    );

    const successfulLines =
      sortedSuccessfulFiles.length === 0
        ? ["- 無"]
        : sortedSuccessfulFiles.map(({ file, risk }) => {
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
      `- High: ${riskCounts.High}`,
      `- Medium: ${riskCounts.Medium}`,
      `- Low: ${riskCounts.Low}`,
      `- None: ${riskCounts.None}`,
      "",
      "## Successful Files",
      ...successfulLines,
      "",
      "## Skipped Files",
      ...skippedLines
    ].join("\n");
  }
}
