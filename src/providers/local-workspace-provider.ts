import {
  mkdirSync,
  writeFileSync
} from "node:fs";

import { LocalRunOutputPublisher } from "./local-run-output-publisher.ts";
import {
  ReviewOutputBoundaryError,
  type ReviewOutputSink,
  type ReviewOutputTarget
} from "./review-output-sink.ts";

/**
 * Bootstrap-level local output sink that initializes the review workspace
 * and yields a run-scoped publisher bound to the resolved OutputTarget.
 */
export class LocalWorkspaceProvider implements ReviewOutputSink {
  initializeRun(outputTarget: ReviewOutputTarget): LocalRunOutputPublisher {
    try {
      // Create shared run directories up front and truncate append-only artifacts before workers start.
      mkdirSync(outputTarget.basePath, { recursive: true });
      mkdirSync(outputTarget.filesPath, { recursive: true });
      writeFileSync(outputTarget.skippedPath, "");
      writeFileSync(outputTarget.toolAuditPath, "");
      return new LocalRunOutputPublisher(outputTarget);
    } catch (error) {
      throw new ReviewOutputBoundaryError(
        "initializeRun",
        extractErrorMessage(error),
        {
          cause: error,
          outputPath: outputTarget.basePath
        }
      );
    }
  }
}

function extractErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
