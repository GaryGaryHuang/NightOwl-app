import {
  countMustFindings,
  countNiceFindings,
  deriveFileRiskLevel,
  RISK_ORDER
} from "../risk-level.ts";
import type { ResolvedFileOutcome } from "../run-outcome-resolver.ts";

interface RunSummarySectionRenderInput {
  resolvedOutcomes: ResolvedFileOutcome[];
}

/**
 * Render the run-level summary section embedded in index.md.
 */
export function renderRunSummarySection(input: RunSummarySectionRenderInput): string {
  const successfulFiles = input.resolvedOutcomes
    .filter(
      (r): r is Extract<ResolvedFileOutcome, { status: "successful" }> =>
        r.status === "successful"
    )
    .map((r) => r.outcome);
  const skippedFiles = input.resolvedOutcomes
    .filter(
      (r): r is Extract<ResolvedFileOutcome, { status: "skipped" }> =>
        r.status === "skipped"
    )
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

  const sortedSuccessfulFiles = [...successfulFilesWithRisk].sort(
    (a, b) => RISK_ORDER[a.risk] - RISK_ORDER[b.risk]
  );

  const successfulLines =
    sortedSuccessfulFiles.length === 0
      ? ["- 無"]
      : sortedSuccessfulFiles.map(({ file, risk }) => {
          const mustCount = countMustFindings(file.findings);
          const niceCount = countNiceFindings(file.findings);

          return `- [${risk}] \`${file.filePath}\` - must=${mustCount}, nice=${niceCount}`;
        });
  const skippedLines =
    skippedFiles.length === 0
      ? ["- 無"]
      : skippedFiles.map(
          (file) => `- \`${file.filePath}\` - ${file.stepId} - ${file.reason}`
        );

  return [
    "## Run Summary",
    `- Final findings totals: must=${totalMust}, nice=${totalNice}`,
    "",
    "### Successful Files",
    ...successfulLines,
    "",
    "### Skipped Files",
    ...skippedLines
  ].join("\n");
}
