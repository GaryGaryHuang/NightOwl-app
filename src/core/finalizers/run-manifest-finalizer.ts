import { countMustFindings, countNiceFindings, deriveFileRiskLevel } from "../risk-level.ts";
import type { RiskLevel } from "../risk-level.ts";
import type {
  OutputTarget,
  PlannedNoteFile
} from "../review-path-resolver.ts";
import type { RunCoverageBuckets } from "../run-coverage.ts";
import type { ResolvedFileOutcome } from "../run-outcome-resolver.ts";
import type { SemanticReviewStats } from "../run-outcomes.ts";

export const MANIFEST_SCHEMA_VERSION = 3 as const;

export interface SuccessfulFileEntry {
  filePath: string;
  notePath: string;
  status: "successful";
  riskLevel: RiskLevel;
  mustCount: number;
  niceCount: number;
  semanticReview: SemanticReviewStats;
}

export interface SkippedFileEntry {
  filePath: string;
  notePath: string;
  status: "skipped";
  failedStepId: string;
  reason: string;
  semanticReview: SemanticReviewStats;
}

export type ManifestFileEntry = SuccessfulFileEntry | SkippedFileEntry;

export interface ManifestSchema {
  schemaVersion: typeof MANIFEST_SCHEMA_VERSION;
  repoRoot: string;
  baseRef: string;
  headRef: string;
  plannedFileCount: number;
  successfulFileCount: number;
  skippedFileCount: number;
  coverage: RunCoverageBuckets;
  semanticLoopStats: ManifestSemanticLoopStats;
  artifacts: OutputTarget;
  files: ManifestFileEntry[];
}

export interface ManifestSemanticLoopStats {
  maxIterationsUsed: number;
  files: ManifestSemanticFileStats[];
}

export interface ManifestSemanticFileStats extends SemanticReviewStats {
  filePath: string;
}

export interface RunManifestRenderInput {
  repoRoot: string;
  baseRef: string;
  headRef: string;
  outputTarget: OutputTarget;
  plannedNotes: PlannedNoteFile[];
  resolvedOutcomes: ResolvedFileOutcome[];
  coverage?: RunCoverageBuckets;
}

/**
 * Render a deterministic machine-readable manifest of the completed review run.
 */
export function renderRunManifest(input: RunManifestRenderInput): string {
    const resolvedOutcomes = input.resolvedOutcomes;

    const successfulCount = resolvedOutcomes.filter((r) => r.status === "successful").length;
    const skippedCount = resolvedOutcomes.filter((r) => r.status === "skipped").length;
    const coverage = input.coverage ?? {
      totalChangedPaths: input.plannedNotes.length,
      reviewableNonDeletedPaths: input.plannedNotes.length,
      plannedReviewableNotePaths: input.plannedNotes.length,
      deletedPaths: 0,
      binaryOrNonReviewablePaths: 0,
      successfulPlannedFiles: successfulCount,
      skippedPlannedFiles: skippedCount,
      changedTests: []
    };

    const files: ManifestFileEntry[] = input.plannedNotes.map(
      (plannedNote, index): ManifestFileEntry => {
        const resolved = resolvedOutcomes[index];
        const semanticReview = getSemanticReview(resolved);

        if (resolved.status === "successful") {
          const mustCount = countMustFindings(resolved.outcome.findings);
          const niceCount = countNiceFindings(resolved.outcome.findings);

          return {
            filePath: plannedNote.filePath,
            notePath: plannedNote.noteFilePath,
            status: "successful",
            riskLevel: deriveFileRiskLevel(resolved.outcome.findings),
            mustCount,
            niceCount,
            semanticReview
          };
        }

        return {
          filePath: plannedNote.filePath,
          notePath: plannedNote.noteFilePath,
          status: "skipped",
          failedStepId: resolved.outcome.stepId,
          reason: resolved.outcome.reason,
          semanticReview
        };
      }
    );
    const semanticLoopStats: ManifestSemanticLoopStats = {
      maxIterationsUsed: Math.max(
        0,
        ...input.resolvedOutcomes.map((outcome) =>
          getSemanticReview(outcome).semanticIterationCount
        )
      ),
      files: input.plannedNotes.map((plannedNote, index) => ({
        filePath: plannedNote.filePath,
        ...getSemanticReview(input.resolvedOutcomes[index])
      }))
    };

    const manifest: ManifestSchema = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      repoRoot: input.repoRoot,
      baseRef: input.baseRef,
      headRef: input.headRef,
      plannedFileCount: input.plannedNotes.length,
      successfulFileCount: successfulCount,
      skippedFileCount: skippedCount,
      coverage,
      semanticLoopStats,
      artifacts: {
        basePath: input.outputTarget.basePath,
        changesetOverviewPath: input.outputTarget.changesetOverviewPath,
        filesPath: input.outputTarget.filesPath,
        summaryPath: input.outputTarget.summaryPath,
        indexPath: input.outputTarget.indexPath,
        skippedPath: input.outputTarget.skippedPath,
        verifierReportPath: input.outputTarget.verifierReportPath,
        manifestPath: input.outputTarget.manifestPath,
        toolAuditPath: input.outputTarget.toolAuditPath
      },
      files
    };

    return JSON.stringify(manifest, null, 2);
}

export type RunManifestRenderer = typeof renderRunManifest;

function getSemanticReview(outcome: ResolvedFileOutcome): SemanticReviewStats {
  return outcome.outcome.semanticReview ?? createEmptySemanticReviewStats();
}

function createEmptySemanticReviewStats(): SemanticReviewStats {
  return {
    status: "not_run",
    semanticIterationCount: 0,
    candidateFindingCount: 0,
    approvedFindingCount: 0,
    missingInformationCount: 0,
    missingInformationConversionCount: 0,
    failedGateCounts: {},
    decisionCounts: {},
    repeatedUnsupportedClaimStopCount: 0
  };
}
