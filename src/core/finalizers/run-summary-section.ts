import {
  countMustFindings,
  countNiceFindings,
  deriveFileRiskLevel,
  RISK_ORDER
} from "../risk-level.ts";
import type { ResolvedFileOutcome } from "../run-outcome-resolver.ts";
import type { SemanticReviewStats } from "../run-outcomes.ts";

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
  const semanticSummary = buildSemanticSummary(input.resolvedOutcomes);

  return [
    "## Run Summary",
    `- Final findings totals: must=${totalMust}, nice=${totalNice}`,
    "",
    "### Semantic Validation",
    `- Passed cleanly: ${semanticSummary.passedCleanly}`,
    `- Passed with limitations: ${semanticSummary.passedWithLimitations}`,
    `- Missing-information items: ${semanticSummary.missingInformationItems}`,
    `- Dropped candidates: ${semanticSummary.droppedCandidates}`,
    `- Max semantic iterations used: ${semanticSummary.maxIterationsUsed}`,
    ...semanticSummary.lines,
    "",
    "### Successful Files",
    ...successfulLines,
    "",
    "### Skipped Files",
    ...skippedLines
  ].join("\n");
}

function buildSemanticSummary(outcomes: ResolvedFileOutcome[]): {
  passedCleanly: number;
  passedWithLimitations: number;
  missingInformationItems: number;
  droppedCandidates: number;
  maxIterationsUsed: number;
  lines: string[];
} {
  let passedCleanly = 0;
  let passedWithLimitations = 0;
  let missingInformationItems = 0;
  let droppedCandidates = 0;
  let maxIterationsUsed = 0;
  const lines: string[] = [];

  for (const outcome of outcomes) {
    const semantic = outcome.outcome.semanticReview ?? createEmptySemanticReviewStats();
    maxIterationsUsed = Math.max(maxIterationsUsed, semantic.semanticIterationCount);
    missingInformationItems += semantic.missingInformationCount;
    droppedCandidates += (semantic.decisionCounts.drop ?? 0);

    if (semantic.status === "passed") {
      passedCleanly += 1;
    } else if (semantic.status === "passed_with_limitations") {
      passedWithLimitations += 1;
    }

    if (semantic.missingInformationCount > 0) {
      lines.push(
        `- \`${outcome.outcome.filePath}\` - ${semantic.status}; approved=${semantic.approvedFindingCount}; missing-information=${semantic.missingInformationCount}`
      );
    }
  }

  return {
    passedCleanly,
    passedWithLimitations,
    missingInformationItems,
    droppedCandidates,
    maxIterationsUsed,
    lines: lines.length === 0 ? ["- 無"] : lines
  };
}

function createEmptySemanticReviewStats(): SemanticReviewStats {
  return {
    status: "not_run",
    semanticIterationCount: 0,
    candidateFindingCount: 0,
    approvedFindingCount: 0,
    missingInformationCount: 0,
    failedGateCounts: {},
    decisionCounts: {}
  };
}
