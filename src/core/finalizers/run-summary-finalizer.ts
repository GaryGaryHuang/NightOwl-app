import { countMustFindings, countNiceFindings, deriveFileRiskLevel, RISK_ORDER, type RiskLevel } from "../risk-level.ts";
import type { RunCoverageBuckets } from "../run-coverage.ts";
import type { ResolvedFileOutcome } from "../run-outcome-resolver.ts";
import type { SemanticReviewStats } from "../run-outcomes.ts";

export interface RunSummaryRenderInput {
  repoRoot: string;
  baseRef: string;
  headRef: string;
  resolvedOutcomes: ResolvedFileOutcome[];
  coverage?: RunCoverageBuckets;
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
    const coverage = input.coverage ?? {
      totalChangedPaths: plannedFileCount,
      reviewableNonDeletedPaths: plannedFileCount,
      plannedReviewableNotePaths: plannedFileCount,
      deletedPaths: 0,
      binaryOrNonReviewablePaths: 0,
      successfulPlannedFiles: successfulFiles.length,
      skippedPlannedFiles: skippedFiles.length,
      changedTests: []
    };

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
    const semanticSummary = buildSemanticSummary(input.resolvedOutcomes);

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
      "## Coverage",
      `- Total changed paths: ${coverage.totalChangedPaths}`,
      `- Reviewable non-deleted paths: ${coverage.reviewableNonDeletedPaths}`,
      `- Planned reviewable notes: ${coverage.plannedReviewableNotePaths}`,
      `- Successful planned files: ${coverage.successfulPlannedFiles}`,
      `- Skipped planned files: ${coverage.skippedPlannedFiles}`,
      `- Deleted paths: ${coverage.deletedPaths}`,
      `- Binary/non-reviewable paths: ${coverage.binaryOrNonReviewablePaths}`,
      `- Changed tests: ${formatChangedTests(coverage.changedTests)}`,
      "",
      "## Risk Distribution",
      `- High: ${riskCounts.High}`,
      `- Low: ${riskCounts.Low}`,
      `- None: ${riskCounts.None}`,
      "",
      "## Semantic Validation",
      `- Passed cleanly: ${semanticSummary.passedCleanly}`,
      `- Passed with limitations: ${semanticSummary.passedWithLimitations}`,
      `- Missing-information items: ${semanticSummary.missingInformationItems}`,
      `- Dropped candidates: ${semanticSummary.droppedCandidates}`,
      `- Max semantic iterations used: ${semanticSummary.maxIterationsUsed}`,
      ...semanticSummary.lines,
      "",
      "## Successful Files",
      ...successfulLines,
      "",
      "## Skipped Files",
      ...skippedLines
    ].join("\n");
}

export type RunSummaryRenderer = typeof renderRunSummary;

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

    if (
      semantic.missingInformationCount > 0
    ) {
      lines.push(
        `- \`${outcome.outcome.filePath}\` — ${semantic.status}; approved=${semantic.approvedFindingCount}; missing-information=${semantic.missingInformationCount}`
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

function formatChangedTests(changedTests: readonly string[]): string {
  return changedTests.length === 0
    ? "無"
    : changedTests.map((filePath) => `\`${filePath}\``).join(", ");
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
