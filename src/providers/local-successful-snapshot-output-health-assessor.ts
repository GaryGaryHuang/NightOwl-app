import { accessSync, constants, statSync } from "node:fs";
import path from "node:path";

import type {
  SuccessfulSnapshotFailureAssessment,
  SuccessfulSnapshotFailureInput,
  SuccessfulSnapshotOutputHealthAssessor
} from "./review-output-sink.ts";

/**
 * Local filesystem heuristic for successful snapshot write failures.
 */
export class LocalSuccessfulSnapshotOutputHealthAssessor
  implements SuccessfulSnapshotOutputHealthAssessor
{
  assess(
    input: SuccessfulSnapshotFailureInput
  ): SuccessfulSnapshotFailureAssessment {
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
      assertWritableDirectory(input.outputTarget.basePath);
      assertWritableDirectory(input.outputTarget.filesPath);
    } catch {
      return { faultScope: "shared-output-target-fault" };
    }

    return { faultScope: "single-file-output-fault" };
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

const SINGLE_FILE_ERROR_CODES = new Set(["EISDIR", "ENAMETOOLONG"]);

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