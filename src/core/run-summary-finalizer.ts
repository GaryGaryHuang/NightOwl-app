import type { PlannedNoteFile } from "./review-path-resolver.ts";
import { deriveFileRiskLevel, RISK_ORDER, type RiskLevel } from "./risk-level.ts";
import { resolveFileOutcomes } from "./run-outcome-resolver.ts";
import type { SuccessfulFileOutcome, SkippedFileOutcome } from "./run-outcomes.ts";

export interface RunSummaryRenderInput {
  repoRoot: string;
  baseRef: string;
  headRef: string;
  plannedNotes: PlannedNoteFile[];
  successfulFiles: SuccessfulFileOutcome[];
  skippedFiles: SkippedFileOutcome[];
}

/**
 * Render the run-level summary from finalized per-file outcomes and derived risk levels.
 */
export class RunSummaryFinalizer {
  render(input: RunSummaryRenderInput): string {
    // Validate that every planned file has a finalized outcome before rendering.
    resolveFileOutcomes(
      input.plannedNotes,
      input.successfulFiles,
      input.skippedFiles
    );

    const plannedFileCount = input.plannedNotes.length;
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
      `- Planned files: ${plannedFileCount}`,
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
