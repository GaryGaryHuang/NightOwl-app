import { deriveFileRiskLevel } from "./risk-level.ts";
import type {
  OutputTarget,
  PlannedNoteFile
} from "./review-path-resolver.ts";
import type {
  SkippedFileOutcome,
  SuccessfulFileOutcome
} from "./run-summary-finalizer.ts";

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
    const files = input.plannedNotes.map((plannedNote) => {
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

    return JSON.stringify(
      {
        schemaVersion: 2,
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
      },
      null,
      2
    );
  }
}
