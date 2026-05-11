import type { PlannedNoteFile } from "./review-path-resolver.ts";
import type { SuccessfulFileOutcome, SkippedFileOutcome } from "./run-outcomes.ts";

export type ResolvedFileOutcome =
  | { status: "successful"; outcome: SuccessfulFileOutcome }
  | { status: "skipped"; outcome: SkippedFileOutcome };

/**
 * Match each planned file to its finalized outcome using O(1) Map lookups.
 *
 * When a file appears in both outcome sets, successfulFiles takes precedence.
 * Throws when a planned file is absent from both sets, enforcing data integrity
 * at the boundary between the Orchestrator and the index finalizer.
 */
export function resolveFileOutcomes(
  plannedNotes: PlannedNoteFile[],
  successfulFiles: SuccessfulFileOutcome[],
  skippedFiles: SkippedFileOutcome[]
): ResolvedFileOutcome[] {
  const successMap = new Map(
    successfulFiles.map((file) => [file.filePath, file])
  );
  const skippedMap = new Map(
    skippedFiles.map((file) => [file.filePath, file])
  );

  return plannedNotes.map((note): ResolvedFileOutcome => {
    const successful = successMap.get(note.filePath);
    if (successful) {
      return { status: "successful", outcome: successful };
    }

    const skipped = skippedMap.get(note.filePath);
    if (skipped) {
      return { status: "skipped", outcome: skipped };
    }

    throw new Error(
      `Missing finalized outcome for planned file: ${note.filePath}`
    );
  });
}
