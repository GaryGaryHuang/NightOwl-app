import {
  accessSync,
  appendFileSync,
  constants,
  mkdirSync,
  statSync,
  writeFileSync
} from "node:fs";
import path from "node:path";

import type { OutputTarget } from "../core/review-path-resolver.ts";
import type {
  ChangesetOverviewResult,
  FileReviewResult,
  ReviewIndexResult,
  ReviewOutputSink,
  RunManifestResult,
  RunSummaryResult,
  SuccessfulSnapshotFailureAssessment,
  SuccessfulSnapshotFailureInput,
  SkipRecord
} from "./review-output-sink.ts";

export class LocalWorkspaceProvider implements ReviewOutputSink {
  #outputTarget?: OutputTarget;

  initializeRun(outputTarget: OutputTarget): void {
    mkdirSync(outputTarget.basePath, { recursive: true });
    mkdirSync(outputTarget.filesPath, { recursive: true });
    writeFileSync(outputTarget.skippedPath, "");
    writeFileSync(outputTarget.toolAuditPath, "");
    this.#outputTarget = outputTarget;
  }

  publishFileReview(fileResult: FileReviewResult): void {
    mkdirSync(path.dirname(fileResult.noteFilePath), { recursive: true });
    writeFileSync(fileResult.noteFilePath, fileResult.content);
  }

  assessSuccessfulSnapshotFailure(
    input: SuccessfulSnapshotFailureInput
  ): SuccessfulSnapshotFailureAssessment {
    if (!this.#outputTarget) {
      return { faultScope: "shared-output-target-fault" };
    }

    const code =
      isErrnoException(input.error) && typeof input.error.code === "string"
        ? input.error.code
        : undefined;

    if (!code) {
      return { faultScope: "shared-output-target-fault" };
    }

    if (SHARED_TARGET_ERROR_CODES.has(code)) {
      return { faultScope: "shared-output-target-fault" };
    }

    const errorPath = resolveErrnoPath(input.error);
    const expectedNotePath = path.resolve(input.noteFilePath);

    if (
      !SINGLE_FILE_ERROR_CODES.has(code) ||
      !errorPath ||
      errorPath !== expectedNotePath
    ) {
      return { faultScope: "shared-output-target-fault" };
    }

    try {
      assertWritableDirectory(this.#outputTarget.basePath);
      assertWritableDirectory(this.#outputTarget.filesPath);
    } catch {
      return { faultScope: "shared-output-target-fault" };
    }

    return { faultScope: "single-file-output-fault" };
  }

  publishSkippedFile(skipRecord: SkipRecord): void {
    if (!this.#outputTarget) {
      throw new Error("Run output target has not been initialized.");
    }

    appendFileSync(
      this.#outputTarget.skippedPath,
      `- \`${skipRecord.filePath}\` — ${skipRecord.stepId} — ${skipRecord.reason}\n`
    );
  }

  publishRunSummary(summaryResult: RunSummaryResult): void {
    if (!this.#outputTarget) {
      throw new Error("Run output target has not been initialized.");
    }

    writeFileSync(this.#outputTarget.summaryPath, summaryResult.content);
  }

  publishReviewIndex(indexResult: ReviewIndexResult): void {
    if (!this.#outputTarget) {
      throw new Error("Run output target has not been initialized.");
    }

    writeFileSync(this.#outputTarget.indexPath, indexResult.content);
  }

  publishRunManifest(manifestResult: RunManifestResult): void {
    if (!this.#outputTarget) {
      throw new Error("Run output target has not been initialized.");
    }

    writeFileSync(this.#outputTarget.manifestPath, manifestResult.content);
  }

  publishChangesetOverview(result: ChangesetOverviewResult): void {
    if (!this.#outputTarget) {
      throw new Error("Run output target has not been initialized.");
    }

    const content = result.content.endsWith("\n")
      ? result.content
      : result.content + "\n";
    writeFileSync(this.#outputTarget.changesetOverviewPath, content);
  }
}

const SHARED_TARGET_ERROR_CODES = new Set([
  "EACCES",
  "EDQUOT",
  "EIO",
  "EMFILE",
  "ENFILE",
  "ENOSPC",
  "EPERM",
  "EROFS"
]);

const SINGLE_FILE_ERROR_CODES = new Set([
  "EISDIR",
  "ENAMETOOLONG"
]);

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}

function resolveErrnoPath(error: unknown): string | undefined {
  if (!isErrnoException(error) || typeof error.path !== "string") {
    return undefined;
  }

  return path.resolve(error.path);
}

function assertWritableDirectory(targetPath: string): void {
  const stat = statSync(targetPath);

  if (!stat.isDirectory()) {
    throw new Error(`${targetPath} is not a directory`);
  }

  accessSync(targetPath, constants.W_OK);
}
