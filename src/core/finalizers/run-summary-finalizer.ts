import { countMustFindings, countNiceFindings, deriveFileRiskLevel, RISK_ORDER, type RiskLevel } from "../risk-level.ts";
import type { ResolvedFileOutcome } from "../run-outcome-resolver.ts";

export interface RunSummaryRenderInput {
  repoRoot: string;
  baseRef: string;
  headRef: string;
  resolvedOutcomes: ResolvedFileOutcome[];
}

/**
 * Render the run-level summary from finalized per-file outcomes and derived risk levels.
 */
export function renderRunSummary(input: RunSummaryRenderInput): string {
    const plannedFileCount = input.resolvedOutcomes.length;
    const successfulFiles = input.resolvedOutcomes
      .filter((r): r is Extract<ResolvedFileOutcome, { status: "successful" }> => r.status === "successful")
      .map((r) => r.outcome);
    const skippedFiles = input.resolvedOutcomes
      .filter((r): r is Extract<ResolvedFileOutcome, { status: "skipped" }> => r.status === "skipped")
      .map((r) => r.outcome);

    const totalMust = successfulFiles.reduce(
      (count, file) => count + countMustFindings(file.findings),
      0
    );
    const totalNice = successfulFiles.reduce(
      (count, file) => count + countNiceFindings(file.findings),
      0
    );

    const successfulFilesWithRisk = successfulFiles.map((file) => ({
      file,
      risk: deriveFileRiskLevel(file.findings)
    }));
    const riskCounts: Record<RiskLevel, number> = {
      High: 0,
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
            const mustCount = countMustFindings(file.findings);
            const niceCount = countNiceFindings(file.findings);

            return `- [${risk}] \`${file.filePath}\` — must=${mustCount}, nice=${niceCount}`;
          });
    const skippedLines =
      skippedFiles.length === 0
        ? ["- 無"]
        : skippedFiles.map(
            (file) => `- \`${file.filePath}\` — ${file.stepId} — ${file.reason}`
          );

    return [
      "# Review Summary",
      "",
      `- Repo root: \`${input.repoRoot}\``,
      `- Base ref: \`${input.baseRef}\``,
      `- Head ref: \`${input.headRef}\``,
      `- Planned files: ${plannedFileCount}`,
      `- Successful files: ${successfulFiles.length}`,
      `- Skipped files: ${skippedFiles.length}`,
      `- Final findings totals: must=${totalMust}, nice=${totalNice}`,
      "",
      "## Risk Distribution",
      `- High: ${riskCounts.High}`,
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

export type RunSummaryRenderer = typeof renderRunSummary;
