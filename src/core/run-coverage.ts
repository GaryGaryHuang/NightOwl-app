import type { ExpectedChangedFileDescriptor } from "./change-map.ts";
import type { RunContext } from "./run-context.ts";

export interface RunCoverageBuckets {
  totalChangedPaths: number;
  reviewableNonDeletedPaths: number;
  plannedReviewableNotePaths: number;
  deletedPaths: number;
  binaryOrNonReviewablePaths: number;
  successfulPlannedFiles: number;
  skippedPlannedFiles: number;
  changedTests: string[];
}

export function buildRunCoverageBuckets(input: {
  runContext: Pick<RunContext, "changesetFiles" | "changesetOverview">;
  plannedReviewableNotePaths: number;
  successfulPlannedFiles: number;
  skippedPlannedFiles: number;
}): RunCoverageBuckets {
  const changedFiles = deriveCoverageFiles(input.runContext);
  const deletedPaths = changedFiles.filter((file) => file.deleted).length;
  const totalChangedPaths = changedFiles.length;
  const reviewableNonDeletedPaths = changedFiles.filter(
    (file) => file.reviewableNonDeleted
  ).length;
  const binaryOrNonReviewablePaths = Math.max(
    0,
    totalChangedPaths - deletedPaths - reviewableNonDeletedPaths
  );
  const changedTests = deriveChangedTests(changedFiles);

  return {
    totalChangedPaths,
    reviewableNonDeletedPaths,
    plannedReviewableNotePaths: input.plannedReviewableNotePaths,
    deletedPaths,
    binaryOrNonReviewablePaths,
    successfulPlannedFiles: input.successfulPlannedFiles,
    skippedPlannedFiles: input.skippedPlannedFiles,
    changedTests: [...new Set(changedTests)].sort()
  };
}

function deriveCoverageFiles(
  runContext: Pick<RunContext, "changesetFiles" | "changesetOverview">
): readonly ExpectedChangedFileDescriptor[] {
  if (runContext.changesetFiles.length > 0) {
    return runContext.changesetFiles;
  }

  const overview = runContext.changesetOverview;
  if ("changedFiles" in overview) {
    return overview.changedFiles.map((file) => ({
      originalStatus: file.status,
      status: file.status,
      path: file.path,
      deleted: file.status === "D",
      copiedAsAdded: false,
      reviewableNonDeleted: file.status !== "D"
    }));
  }

  return [];
}

function deriveChangedTests(
  changedFiles: readonly ExpectedChangedFileDescriptor[]
): string[] {
  return changedFiles
    .filter((file) => /(?:^|\/)(?:test|tests|__tests__)\//u.test(file.path) || /(?:\.test|\.spec)\.[^.]+$/u.test(file.path))
    .map((file) => file.path);
}
