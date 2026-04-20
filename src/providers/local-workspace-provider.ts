import {
  mkdir,
  writeFile
} from "node:fs/promises";

import { LocalRunOutputPublisher } from "./local-run-output-publisher.ts";
import {
  ReviewOutputBoundaryError,
  type ReviewOutputPlan,
  type ReviewOutputSink,
  type RunOutputPublisher
} from "./review-output-sink.ts";
import { wrapBoundaryError } from "./boundary-error-helper.ts";

/**
 * Bootstrap-level local output sink that initializes the review workspace
 * and yields a run-scoped publisher bound to the resolved OutputTarget.
 */
export class LocalWorkspaceProvider implements ReviewOutputSink {
  async initializeRun(outputPlan: ReviewOutputPlan): Promise<RunOutputPublisher> {
    const { outputTarget } = outputPlan;

    return wrapBoundaryError(
      async () => {
        // Create shared run directories up front and truncate append-only artifacts before workers start.
        await mkdir(outputTarget.basePath, { recursive: true });
        await mkdir(outputTarget.filesPath, { recursive: true });
        await writeFile(outputTarget.skippedPath, "");
        await writeFile(outputTarget.toolAuditPath, "");
        return new LocalRunOutputPublisher(outputPlan);
      },
      (cause) => new ReviewOutputBoundaryError(
        "initializeRun",
        extractErrorMessage(cause),
        { cause, outputPath: outputTarget.basePath }
      )
    );
  }
}

function extractErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
