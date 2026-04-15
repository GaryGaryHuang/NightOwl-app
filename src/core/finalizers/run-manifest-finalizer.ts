import { deriveFileRiskLevel } from "../risk-level.ts";
import type { RiskLevel } from "../risk-level.ts";
import type {
  OutputTarget,
  PlannedNoteFile
} from "../review-path-resolver.ts";
import { resolveFileOutcomes } from "../run-outcome-resolver.ts";
import type { SuccessfulFileOutcome, SkippedFileOutcome } from "../run-outcomes.ts";

export const MANIFEST_SCHEMA_VERSION = 2 as const;

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
  successfulFiles: SuccessfulFileOutcome[];
  skippedFiles: SkippedFileOutcome[];
}

/**
 * Render a deterministic machine-readable manifest of the completed review run.
 */
export class RunManifestFinalizer {
  render(input: RunManifestRenderInput): string {
    const resolvedOutcomes = resolveFileOutcomes(
      input.plannedNotes,
      input.successfulFiles,
      input.skippedFiles
    );

    const files: ManifestFileEntry[] = input.plannedNotes.map(
      (plannedNote, index): ManifestFileEntry => {
        const resolved = resolvedOutcomes[index];

        if (resolved.status === "successful") {
          const mustCount = resolved.outcome.findings.filter(
            (finding) => finding.type === "must"
          ).length;
          const niceCount = resolved.outcome.findings.filter(
            (finding) => finding.type === "nice"
          ).length;

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
      successfulFileCount: input.successfulFiles.length,
      skippedFileCount: input.skippedFiles.length,
      artifacts: {
        basePath: input.outputTarget.basePath,
        changesetOverviewPath: input.outputTarget.changesetOverviewPath,
        filesPath: input.outputTarget.filesPath,
        summaryPath: input.outputTarget.summaryPath,
        indexPath: input.outputTarget.indexPath,
        skippedPath: input.outputTarget.skippedPath,
        manifestPath: input.outputTarget.manifestPath,
        toolAuditPath: input.outputTarget.toolAuditPath
      },
      files
    };

    return JSON.stringify(manifest, null, 2);
  }
}
