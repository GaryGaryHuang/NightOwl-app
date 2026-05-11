import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  ReviewOutputBoundaryError,
  type ReviewOutputBoundaryOperation,
  type ContentResult,
  type FileReviewResult,
  type ReviewArtifactKind,
  type ReviewOutputPlan,
  type RunOutputPublisher,
  type ReviewOutputTarget
} from "./review-output-sink.ts";
import { wrapBoundaryError } from "./boundary-error-helper.ts";

/**
 * Run-scoped local artifact publisher bound to one resolved OutputTarget.
 */
export class LocalRunOutputPublisher implements RunOutputPublisher {
  readonly #outputTarget: ReviewOutputTarget;
  readonly #notePathByFilePath: Map<string, string>;

  constructor(outputPlan: ReviewOutputPlan) {
    this.#outputTarget = outputPlan.outputTarget;
    this.#notePathByFilePath = new Map(
      outputPlan.plannedNotes.map((plannedNote) => [
        plannedNote.filePath,
        plannedNote.noteFilePath
      ])
    );
  }

  async publishFileReview(fileResult: FileReviewResult): Promise<void> {
    const noteFilePath = this.#resolveNoteFilePath(fileResult.filePath);

    return wrapBoundaryError(
      async () => {
        await mkdir(path.dirname(noteFilePath), { recursive: true });
        await writeFile(noteFilePath, fileResult.content);
      },
      (cause) => toOutputBoundaryError("publishFileReview", cause, noteFilePath)
    );
  }

  async publishArtifact(kind: ReviewArtifactKind, result: ContentResult): Promise<void> {
    const outputPath = this.#resolveArtifactPath(kind);

    return wrapBoundaryError(
      () => writeFile(outputPath, result.content),
      (cause) => toOutputBoundaryError(`publishArtifact:${kind}`, cause, outputPath)
    );
  }

  #resolveArtifactPath(kind: ReviewArtifactKind): string {
    const pathMap: Record<ReviewArtifactKind, string> = {
      "changeset-overview": this.#outputTarget.changesetOverviewPath,
      "index": this.#outputTarget.indexPath
    };

    return pathMap[kind];
  }

  #resolveNoteFilePath(filePath: string): string {
    const noteFilePath = this.#notePathByFilePath.get(filePath);

    if (!noteFilePath) {
      throw new ReviewOutputBoundaryError(
        "publishFileReview",
        `No planned note output path found for file: ${filePath}`
      );
    }

    return noteFilePath;
  }
}

function toOutputBoundaryError(
  operation: ReviewOutputBoundaryOperation,
  error: unknown,
  outputPath: string
): ReviewOutputBoundaryError {
  const message = error instanceof Error ? error.message : String(error);

  return new ReviewOutputBoundaryError(operation, message, {
    cause: error,
    outputPath
  });
}
