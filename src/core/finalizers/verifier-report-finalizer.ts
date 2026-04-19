import type { PlannedNoteFile } from "../review-path-resolver.ts";
import { resolveFileOutcomes } from "../run-outcome-resolver.ts";
import type { SkippedFileOutcome, SuccessfulFileOutcome } from "../run-outcomes.ts";

export interface VerifierReportRenderInput {
  plannedNotes: PlannedNoteFile[];
  successfulFiles: SuccessfulFileOutcome[];
  skippedFiles: SkippedFileOutcome[];
}

export class VerifierReportFinalizer {
  render(input: VerifierReportRenderInput): string {
    const resolved = resolveFileOutcomes(
      input.plannedNotes,
      input.successfulFiles,
      input.skippedFiles
    );

    return resolved
      .flatMap((item) => item.outcome.verifierReportEntries)
      .map((entry) =>
        JSON.stringify({
          filePath: entry.filePath,
          stepId: entry.stepId,
          findingId: entry.findingId,
          taxonomy: entry.taxonomy,
          outcome: entry.outcome,
          gate: entry.gate,
          reason: entry.reason
        })
      )
      .join("\n");
  }
}