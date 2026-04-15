import path from "node:path";

import type {
  OutputTarget,
  PlannedNoteFile
} from "./review-path-resolver.ts";
import { deriveFileRiskLevel, RISK_ORDER } from "./risk-level.ts";
import { resolveFileOutcomes } from "./run-outcome-resolver.ts";
import type { SuccessfulFileOutcome, SkippedFileOutcome } from "./run-outcomes.ts";

// Derives from RISK_ORDER key count so skipped items always sort after every known risk level.
const SKIPPED_SORT_KEY = Object.keys(RISK_ORDER).length;

export interface ReviewIndexRenderInput {
  repoRoot: string;
  baseRef: string;
  headRef: string;
  outputTarget: OutputTarget;
  plannedNotes: PlannedNoteFile[];
  successfulFiles: SuccessfulFileOutcome[];
  skippedFiles: SkippedFileOutcome[];
}

/**
 * Render the run index with deterministic artifact links and severity-ordered file notes.
 */
export class ReviewIndexFinalizer {
  render(input: ReviewIndexRenderInput): string {
    const resolvedOutcomes = resolveFileOutcomes(
      input.plannedNotes,
      input.successfulFiles,
      input.skippedFiles
    );

    const indexedOutcomes = input.plannedNotes.map((note, index) => ({
      note,
      resolved: resolvedOutcomes[index]
    }));

    const sortedEntries = [...indexedOutcomes].sort((a, b) => {
      const aKey = a.resolved.status === "successful"
        ? RISK_ORDER[deriveFileRiskLevel(a.resolved.outcome.findings)]
        : SKIPPED_SORT_KEY;
      const bKey = b.resolved.status === "successful"
        ? RISK_ORDER[deriveFileRiskLevel(b.resolved.outcome.findings)]
        : SKIPPED_SORT_KEY;
      return aKey - bKey;
    });

    const fileNoteLines =
      sortedEntries.length === 0
        ? ["- 無"]
        : sortedEntries.map(({ note, resolved }) => {
            const link = toRelativeLink(
              input.outputTarget.basePath,
              note.noteFilePath
            );

            if (resolved.status === "successful") {
              const prefix = `[${deriveFileRiskLevel(resolved.outcome.findings)}]`;
              return `- ${prefix} [\`${note.filePath}\`](${link})`;
            }

            return `- [Skipped] [\`${note.filePath}\`](${link})`;
          });

    return [
      "# Review Index",
      "",
      `- Repo root: \`${input.repoRoot}\``,
      `- Base ref: \`${input.baseRef}\``,
      `- Head ref: \`${input.headRef}\``,
      `- Planned files: ${input.plannedNotes.length}`,
      `- Successful files: ${input.successfulFiles.length}`,
      `- Skipped files: ${input.skippedFiles.length}`,
      "",
      "## Run Artifacts",
      `- [changeset-overview.md](${toRelativeLink(input.outputTarget.basePath, input.outputTarget.changesetOverviewPath)})`,
      `- [summary.md](${toRelativeLink(input.outputTarget.basePath, input.outputTarget.summaryPath)})`,
      `- [skipped.md](${toRelativeLink(input.outputTarget.basePath, input.outputTarget.skippedPath)})`,
      "",
      "## File Notes",
      ...fileNoteLines
    ].join("\n");
  }
}

function toRelativeLink(basePath: string, targetPath: string): string {
  const normalizedBasePath = normalizeForLink(basePath);
  const normalizedTargetPath = normalizeForLink(targetPath);
  const relativePath = path.posix.relative(normalizedBasePath, normalizedTargetPath);
  const encodedPath = relativePath
    .split("/")
    .map((segment) => encodePathSegment(segment))
    .join("/");

  return `./${encodedPath}`;
}

function normalizeForLink(filePath: string): string {
  return filePath.replace(/\\/gu, "/");
}

function encodePathSegment(segment: string): string {
  return encodeURIComponent(segment).replace(
    /[!'()*]/gu,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
}
