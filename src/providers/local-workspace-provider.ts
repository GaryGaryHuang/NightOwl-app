import {
  mkdirSync,
  writeFileSync
} from "node:fs";

import type { OutputTarget } from "../core/review-path-resolver.ts";
import { LocalRunOutputPublisher } from "./local-run-output-publisher.ts";
import type { ReviewOutputSink } from "./review-output-sink.ts";

/**
 * Bootstrap-level local output sink that initializes the review workspace
 * and yields a run-scoped publisher bound to the resolved OutputTarget.
 */
export class LocalWorkspaceProvider implements ReviewOutputSink {
  initializeRun(outputTarget: OutputTarget): LocalRunOutputPublisher {
    // Create shared run directories up front and truncate append-only artifacts before workers start.
    mkdirSync(outputTarget.basePath, { recursive: true });
    mkdirSync(outputTarget.filesPath, { recursive: true });
    writeFileSync(outputTarget.skippedPath, "");
    writeFileSync(outputTarget.toolAuditPath, "");
    return new LocalRunOutputPublisher(outputTarget);
  }
}
