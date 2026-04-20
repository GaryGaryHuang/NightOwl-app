import { access, stat, constants } from "node:fs/promises";
import path from "node:path";

import type {
  OutputWriteFailureAssessment,
  OutputWriteFailureInput,
  OutputWriteHealthAssessor
} from "./review-output-health-assessor.ts";

/**
 * Local filesystem heuristic for output write failures during successful snapshot publication.
 */
export class LocalOutputWriteHealthAssessor
  implements OutputWriteHealthAssessor
{
  async assess(
    input: OutputWriteFailureInput
  ): Promise<OutputWriteFailureAssessment> {
    const code = input.failureEvidence.causeCode;

    if (!code) {
      return { faultScope: "shared-output-target-fault" };
    }

    if (SHARED_TARGET_ERROR_CODES.has(code)) {
      return { faultScope: "shared-output-target-fault" };
    }

    const errorPath =
      typeof input.failureEvidence.causePath === "string"
        ? path.resolve(input.failureEvidence.causePath)
        : undefined;
    const expectedNotePath = path.resolve(input.noteFilePath);

    if (
      !SINGLE_FILE_ERROR_CODES.has(code) ||
      !errorPath ||
      errorPath !== expectedNotePath
    ) {
      return { faultScope: "shared-output-target-fault" };
    }

    try {
      await assertWritableDirectory(input.outputTarget.basePath);
      await assertWritableDirectory(input.outputTarget.filesPath);
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

async function assertWritableDirectory(targetPath: string): Promise<void> {
  const statResult = await stat(targetPath);

  if (!statResult.isDirectory()) {
    throw new Error(`${targetPath} is not a directory`);
  }

  await access(targetPath, constants.W_OK);
}
