import { deriveFileRiskLevel } from "./risk-level.ts";
import type { RiskLevel } from "./risk-level.ts";
import type {
  OutputTarget,
  PlannedNoteFile
} from "./review-path-resolver.ts";
import type { SkippedFileOutcome, SuccessfulFileOutcome } from "./run-outcomes.ts";

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
    const files: ManifestFileEntry[] = input.plannedNotes.map((plannedNote): ManifestFileEntry => {
      const successfulFile = input.successfulFiles.find(
        (file) => file.filePath === plannedNote.filePath
      );

      if (successfulFile) {
        const mustCount = successfulFile.findings.filter(
          (finding) => finding.type === "must"
        ).length;
        const niceCount = successfulFile.findings.filter(
          (finding) => finding.type === "nice"
        ).length;

        return {
          filePath: plannedNote.filePath,
          notePath: plannedNote.noteFilePath,
          status: "successful",
          riskLevel: deriveFileRiskLevel(successfulFile.findings),
          mustCount,
          niceCount
        };
      }

      const skippedFile = input.skippedFiles.find(
        (file) => file.filePath === plannedNote.filePath
      );

      if (skippedFile) {
        return {
          filePath: plannedNote.filePath,
          notePath: plannedNote.noteFilePath,
          status: "skipped",
          failedStepId: skippedFile.stepId,
          reason: skippedFile.reason
        };
      }

      throw new Error(`Missing finalized outcome for planned file: ${plannedNote.filePath}`);
    });

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
