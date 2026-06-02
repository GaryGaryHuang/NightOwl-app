import path from "node:path";

import type {
  OutputWriteFailureAssessment,
  OutputWriteFailureAssessmentRequest,
  OutputWriteFailureEvidence,
  OutputWriteFailureInput,
  OutputWriteHealthAssessor
} from "./review-output-health-assessor.ts";
import { ReviewOutputBoundaryError } from "./review-output-sink.ts";

/**
 * Converts snapshot write failures into the provider-local evidence surface used
 * by output write health assessors, with a conservative shared-target fallback.
 */
export async function resolveOutputWriteFailureAssessment(
  assessor: OutputWriteHealthAssessor,
  input: OutputWriteFailureAssessmentRequest
): Promise<OutputWriteFailureAssessment> {
  try {
    const assessorInput: OutputWriteFailureInput = {
      outputTarget: input.outputTarget,
      noteFilePath: input.noteFilePath,
      failureEvidence: createOutputWriteFailureEvidence(input.error)
    };
    // Default to the conservative shared-target classification unless the sink can prove a single-file fault.
    return (await assessor.assess(assessorInput)) ?? { faultScope: "shared-output-target-fault" };
  } catch {
    return { faultScope: "shared-output-target-fault" };
  }
}

function createOutputWriteFailureEvidence(
  error: unknown
): OutputWriteFailureEvidence {
  const underlyingError =
    error instanceof ReviewOutputBoundaryError ? error.cause ?? error : error;
  const causeCode =
    isErrnoException(underlyingError) && typeof underlyingError.code === "string"
      ? underlyingError.code
      : undefined;
  const causePath =
    isErrnoException(underlyingError) && typeof underlyingError.path === "string"
      ? path.resolve(underlyingError.path)
      : undefined;

  return {
    ...(causeCode === undefined ? {} : { causeCode }),
    ...(causePath === undefined ? {} : { causePath })
  };
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
