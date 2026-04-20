import { countMustFindings, countNiceFindings, deriveFileRiskLevel } from "../risk-level.ts";
import type { RiskLevel } from "../risk-level.ts";
import type {
  OutputTarget,
  PlannedNoteFile
} from "../review-path-resolver.ts";
import type { ResolvedFileOutcome } from "../run-outcome-resolver.ts";

export const MANIFEST_SCHEMA_VERSION = 3 as const;

export interface SuccessfulFileEntry {
  filePath: string;
  notePath: string;
  status: "successful";
  riskLevel: RiskLevel;
  mustCount: number;
  niceCount: number;
}

export interface SkippedFileEntry {
  filePath: string;
  notePath: string;
  status: "skipped";
  failedStepId: string;
  reason: string;
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
  artifacts: OutputTarget;
  files: ManifestFileEntry[];
}

export interface RunManifestRenderInput {
  repoRoot: string;
  baseRef: string;
  headRef: string;
  outputTarget: OutputTarget;
  plannedNotes: PlannedNoteFile[];
  resolvedOutcomes: ResolvedFileOutcome[];
}

/**
 * Render a deterministic machine-readable manifest of the completed review run.
 */
export function renderRunManifest(input: RunManifestRenderInput): string {
    const resolvedOutcomes = input.resolvedOutcomes;

    const successfulCount = resolvedOutcomes.filter((r) => r.status === "successful").length;
    const skippedCount = resolvedOutcomes.filter((r) => r.status === "skipped").length;

    const files: ManifestFileEntry[] = input.plannedNotes.map(
      (plannedNote, index): ManifestFileEntry => {
        const resolved = resolvedOutcomes[index];

        if (resolved.status === "successful") {
          const mustCount = countMustFindings(resolved.outcome.findings);
          const niceCount = countNiceFindings(resolved.outcome.findings);

          return {
            filePath: plannedNote.filePath,
            notePath: plannedNote.noteFilePath,
            status: "successful",
            riskLevel: deriveFileRiskLevel(resolved.outcome.findings),
            mustCount,
            niceCount
          };
        }

        return {
          filePath: plannedNote.filePath,
          notePath: plannedNote.noteFilePath,
          status: "skipped",
          failedStepId: resolved.outcome.stepId,
          reason: resolved.outcome.reason
        };
      }
    );

    const manifest: ManifestSchema = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      repoRoot: input.repoRoot,
      baseRef: input.baseRef,
      headRef: input.headRef,
      plannedFileCount: input.plannedNotes.length,
      successfulFileCount: successfulCount,
      skippedFileCount: skippedCount,
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
