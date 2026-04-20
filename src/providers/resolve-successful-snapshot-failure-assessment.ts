import path from "node:path";

import type {
  OutputWriteFailureAssessment,
  OutputWriteFailureAssessmentRequest,
  OutputWriteFailureEvidence,
  OutputWriteFailureInput,
  OutputWriteHealthAssessor
} from "./review-output-health-assessor.ts";
import { ReviewOutputBoundaryError } from "./review-output-sink.ts";

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

export function createOutputWriteFailureEvidence(
  error: unknown
): OutputWriteFailureEvidence {
  const boundaryError =
    error instanceof ReviewOutputBoundaryError ? error : undefined;
  const underlyingError = boundaryError?.cause ?? error;
  const causeCode =
    isErrnoException(underlyingError) && typeof underlyingError.code === "string"
      ? underlyingError.code
      : undefined;
  const causePath =
    isErrnoException(underlyingError) && typeof underlyingError.path === "string"
      ? path.resolve(underlyingError.path)
      : undefined;

  if (boundaryError) {
    return {
      kind: "review-output-boundary-error",
      message: boundaryError.message,
      operation: boundaryError.operation,
      outputPath: boundaryError.outputPath,
      causeCode,
      causePath
    };
  }

  if (error instanceof Error) {
    return {
      kind: "error",
      message: error.message,
      causeCode,
      causePath
    };
  }

  return {
    kind: "non-error",
    message: String(error),
    causeCode,
    causePath
  };
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
