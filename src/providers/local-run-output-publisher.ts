import { appendFile, mkdir, writeFile } from "node:fs/promises";
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
  type VerifierReportResult,
  type ReviewOutputTarget
} from "./review-output-sink.ts";
import { wrapBoundaryError } from "./boundary-error-helper.ts";
import { AsyncMutex } from "./async-mutex.ts";

/**
 * Run-scoped local artifact publisher bound to one resolved OutputTarget.
 */
export class LocalRunOutputPublisher implements RunOutputPublisher {
  readonly #outputTarget: ReviewOutputTarget;
  readonly #skippedMutex = new AsyncMutex();

  constructor(outputTarget: ReviewOutputTarget) {
    this.#outputTarget = outputTarget;
  }

  async publishFileReview(fileResult: FileReviewResult): Promise<void> {
    return wrapBoundaryError(
      async () => {
        await mkdir(path.dirname(fileResult.noteFilePath), { recursive: true });
        await writeFile(fileResult.noteFilePath, fileResult.content);
      },
      (cause) => toOutputBoundaryError("publishFileReview", cause, fileResult.noteFilePath)
    );
  }

  async publishSkippedFile(skipRecord: SkipRecord): Promise<void> {
    return this.#skippedMutex.run(() =>
      wrapBoundaryError(
        () => appendFile(
          this.#outputTarget.skippedPath,
          `- \`${skipRecord.filePath}\` — ${skipRecord.stepId} — ${skipRecord.reason}\n`
        ),
        (cause) => toOutputBoundaryError(
          "publishSkippedFile",
          cause,
          this.#outputTarget.skippedPath
        )
      )
    );
  }

  async publishRunSummary(summaryResult: RunSummaryResult): Promise<void> {
    return wrapBoundaryError(
      () => writeFile(this.#outputTarget.summaryPath, summaryResult.content),
      (cause) => toOutputBoundaryError(
        "publishRunSummary",
        cause,
        this.#outputTarget.summaryPath
      )
    );
  }

  async publishReviewIndex(indexResult: ReviewIndexResult): Promise<void> {
    return wrapBoundaryError(
      () => writeFile(this.#outputTarget.indexPath, indexResult.content),
      (cause) => toOutputBoundaryError(
        "publishReviewIndex",
        cause,
        this.#outputTarget.indexPath
      )
    );
  }

  async publishVerifierReport(result: VerifierReportResult): Promise<void> {
    return wrapBoundaryError(
      () => writeFile(this.#outputTarget.verifierReportPath, result.content),
      (cause) => toOutputBoundaryError(
        "publishVerifierReport",
        cause,
        this.#outputTarget.verifierReportPath
      )
    );
  }

  async publishRunManifest(manifestResult: RunManifestResult): Promise<void> {
    return wrapBoundaryError(
      () => writeFile(this.#outputTarget.manifestPath, manifestResult.content),
      (cause) => toOutputBoundaryError(
        "publishRunManifest",
        cause,
        this.#outputTarget.manifestPath
      )
    );
  }

  async publishChangesetOverview(result: ChangesetOverviewResult): Promise<void> {
    return wrapBoundaryError(
      () => writeFile(this.#outputTarget.changesetOverviewPath, result.content),
      (cause) => toOutputBoundaryError(
        "publishChangesetOverview",
        cause,
        this.#outputTarget.changesetOverviewPath
      )
    );
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
