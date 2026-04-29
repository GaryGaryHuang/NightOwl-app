import type { ReviewRunSummary } from "../core/orchestrator.ts";

export const LOCAL_REVIEW_RUN_HEADER = "Review run completed.";

export function formatLocalReviewRunSummary(result: ReviewRunSummary): string {
  const header = result.dryRun
    ? `[DRY RUN] ${LOCAL_REVIEW_RUN_HEADER}`
    : LOCAL_REVIEW_RUN_HEADER;
  const lines = [
    header,
    `Planned files: ${result.plannedFileCount}`,
    `Successful files: ${result.successfulFileCount}`,
    `Skipped files: ${result.skippedFileCount}`
  ];

  if (result.finalizerFailures.length > 0) {
    const artifacts = result.finalizerFailures.map((f) => f.artifact).join(", ");
    lines.push(`Warning: Failed to write run-level artifacts: ${artifacts}`);
  }

  return lines.join("\n");
}
