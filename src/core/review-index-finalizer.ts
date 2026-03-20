import path from "node:path";

import type {
  OutputTarget,
  PlannedNoteFile
} from "./review-path-resolver.ts";

export interface ReviewIndexRenderInput {
  repoRoot: string;
  baseRef: string;
  headRef: string;
  plannedFileCount: number;
  successfulFileCount: number;
  skippedFileCount: number;
  outputTarget: OutputTarget;
  plannedNotes: PlannedNoteFile[];
}

export class ReviewIndexFinalizer {
  render(input: ReviewIndexRenderInput): string {
    const fileNoteLines =
      input.plannedNotes.length === 0
        ? ["- 無"]
        : input.plannedNotes.map(
            (plannedNote) =>
              `- [\`${plannedNote.filePath}\`](${toRelativeLink(
                input.outputTarget.basePath,
                plannedNote.noteFilePath
              )})`
          );

    return [
      "# Review Index",
      "",
      `- Repo root: \`${input.repoRoot}\``,
      `- Base ref: \`${input.baseRef}\``,
      `- Head ref: \`${input.headRef}\``,
      `- Planned files: ${input.plannedFileCount}`,
      `- Successful files: ${input.successfulFileCount}`,
      `- Skipped files: ${input.skippedFileCount}`,
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
