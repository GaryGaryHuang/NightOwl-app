import path from "node:path";

import type {
  OutputTarget,
  PlannedNoteFile
} from "./review-path-resolver.ts";
import { deriveFileRiskLevel, RISK_ORDER, type RiskLevel } from "./risk-level.ts";
import type {
  SkippedFileOutcome,
  SuccessfulFileOutcome
} from "./run-summary-finalizer.ts";

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

export class ReviewIndexFinalizer {
  render(input: ReviewIndexRenderInput): string {
    const sortedNotes = [...input.plannedNotes].sort((a, b) => {
      const aKey = getSortKey(a.filePath, input.successfulFiles);
      const bKey = getSortKey(b.filePath, input.successfulFiles);
      return aKey - bKey;
    });

    const fileNoteLines =
      sortedNotes.length === 0
        ? ["- 無"]
        : sortedNotes.map((plannedNote) => {
            const successfulFile = input.successfulFiles.find(
              (f) => f.filePath === plannedNote.filePath
            );
              if (successfulFile) {
                const prefix = `[${deriveFileRiskLevel(successfulFile.findings)}]`;
                const link = toRelativeLink(
                  input.outputTarget.basePath,
                  plannedNote.noteFilePath
                );
                return `- ${prefix} [\`${plannedNote.filePath}\`](${link})`;
              }

              const skippedFile = input.skippedFiles.find(
                (f) => f.filePath === plannedNote.filePath
              );
              if (skippedFile) {
                const link = toRelativeLink(
                  input.outputTarget.basePath,
                  plannedNote.noteFilePath
                );
                return `- [Skipped] [\`${plannedNote.filePath}\`](${link})`;
              }

              throw new Error(
                `Missing finalized outcome for planned file: ${plannedNote.filePath}`
              );
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
      `- [summary.md](${toRelativeLink(input.outputTarget.basePath, input.outputTarget.summaryPath)})`,
      `- [skipped.md](${toRelativeLink(input.outputTarget.basePath, input.outputTarget.skippedPath)})`,
      "",
      "## File Notes",
      ...fileNoteLines
    ].join("\n");
  }
}

function getSortKey(
  filePath: string,
  successfulFiles: SuccessfulFileOutcome[]
): number {
  const successfulFile = successfulFiles.find((f) => f.filePath === filePath);
  if (successfulFile) {
    return RISK_ORDER[deriveFileRiskLevel(successfulFile.findings)];
  }
  return SKIPPED_SORT_KEY; // Skipped — always last
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
