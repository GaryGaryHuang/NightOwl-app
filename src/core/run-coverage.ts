import type { ChangeMapReadiness } from "./change-map.ts";

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
  changesetOverview: ChangeMapReadiness;
  plannedReviewableNotePaths: number;
  successfulPlannedFiles: number;
  skippedPlannedFiles: number;
}): RunCoverageBuckets {
  const overview = input.changesetOverview;
  const changedFiles = overview.changedFiles;
  const deletedPaths = "changeScope" in overview
    ? overview.changeScope.deletedPaths
    : changedFiles.filter((file) => file.status === "D").length;
  const totalChangedPaths = "changeScope" in overview
    ? overview.changeScope.totalChangedPaths
    : changedFiles.length;
  const reviewableNonDeletedPaths = "changeScope" in overview
    ? overview.changeScope.reviewableNonDeletedPaths
    : changedFiles.filter((file) => file.status !== "D").length;
  const binaryOrNonReviewablePaths = "changeScope" in overview
    ? overview.changeScope.binaryOrNonReviewablePaths
    : Math.max(0, totalChangedPaths - deletedPaths - input.plannedReviewableNotePaths);
  const changedTests = "changeScope" in overview
    ? [...overview.changeScope.changedTests]
    : deriveChangedTests(overview);

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

function deriveChangedTests(overview: ChangeMapReadiness): string[] {
  return [
    ...overview.changedFiles
      .filter((file) => file.category === "test")
      .map((file) => file.path),
    ...overview.testCoverageObservations.map((entry) => entry.testFile)
  ];
}
