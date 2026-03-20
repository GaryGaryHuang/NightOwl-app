import type { Finding } from "./file-review-context.ts";

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

    const successfulLines =
      input.successfulFiles.length === 0
        ? ["- 無"]
        : input.successfulFiles.map((file) => {
            const mustCount = file.findings.filter(
              (finding) => finding.type === "must"
            ).length;
            const niceCount = file.findings.filter(
              (finding) => finding.type === "nice"
            ).length;

            return `- \`${file.filePath}\` — must=${mustCount}, nice=${niceCount}`;
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
      "## Successful Files",
      ...successfulLines,
      "",
      "## Skipped Files",
      ...skippedLines
    ].join("\n");
  }
}
