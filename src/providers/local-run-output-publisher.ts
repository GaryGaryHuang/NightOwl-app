import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  ReviewOutputBoundaryError,
  type ReviewOutputBoundaryOperation,
  type ChangesetOverviewResult,
  type FileReviewResult,
  type ReviewIndexResult,
  type RunManifestResult,
  type RunOutputPublisher,
  type RunSummaryResult,
  type SkipRecord,
  type ReviewOutputTarget
} from "./review-output-sink.ts";

/**
 * Run-scoped local artifact publisher bound to one resolved OutputTarget.
 */
export class LocalRunOutputPublisher implements RunOutputPublisher {
  readonly #outputTarget: ReviewOutputTarget;

  constructor(outputTarget: ReviewOutputTarget) {
    this.#outputTarget = outputTarget;
  }

  publishFileReview(fileResult: FileReviewResult): void {
    try {
      mkdirSync(path.dirname(fileResult.noteFilePath), { recursive: true });
      writeFileSync(fileResult.noteFilePath, fileResult.content);
    } catch (error) {
      throw toOutputBoundaryError("publishFileReview", error, fileResult.noteFilePath);
    }
  }

  publishSkippedFile(skipRecord: SkipRecord): void {
    try {
      appendFileSync(
        this.#outputTarget.skippedPath,
        `- \`${skipRecord.filePath}\` — ${skipRecord.stepId} — ${skipRecord.reason}\n`
      );
    } catch (error) {
      throw toOutputBoundaryError(
        "publishSkippedFile",
        error,
        this.#outputTarget.skippedPath
      );
    }
  }

  publishRunSummary(summaryResult: RunSummaryResult): void {
    try {
      writeFileSync(this.#outputTarget.summaryPath, summaryResult.content);
    } catch (error) {
      throw toOutputBoundaryError(
        "publishRunSummary",
        error,
        this.#outputTarget.summaryPath
      );
    }
  }

  publishReviewIndex(indexResult: ReviewIndexResult): void {
    try {
      writeFileSync(this.#outputTarget.indexPath, indexResult.content);
    } catch (error) {
      throw toOutputBoundaryError(
        "publishReviewIndex",
        error,
        this.#outputTarget.indexPath
      );
    }
  }

  publishRunManifest(manifestResult: RunManifestResult): void {
    try {
      writeFileSync(this.#outputTarget.manifestPath, manifestResult.content);
    } catch (error) {
      throw toOutputBoundaryError(
        "publishRunManifest",
        error,
        this.#outputTarget.manifestPath
      );
    }
  }

  publishChangesetOverview(result: ChangesetOverviewResult): void {
    const content = result.content.endsWith("\n")
      ? result.content
      : result.content + "\n";
    try {
      writeFileSync(this.#outputTarget.changesetOverviewPath, content);
    } catch (error) {
      throw toOutputBoundaryError(
        "publishChangesetOverview",
        error,
        this.#outputTarget.changesetOverviewPath
      );
    }
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
