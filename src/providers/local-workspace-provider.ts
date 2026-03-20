import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { OutputTarget } from "../core/review-path-resolver.ts";
import type {
  FileReviewResult,
  ReviewIndexResult,
  ReviewOutputSink,
  RunSummaryResult,
  SkipRecord
} from "./review-output-sink.ts";

export class LocalWorkspaceProvider implements ReviewOutputSink {
  #outputTarget?: OutputTarget;

  initializeRun(outputTarget: OutputTarget): void {
    mkdirSync(outputTarget.basePath, { recursive: true });
    mkdirSync(outputTarget.filesPath, { recursive: true });
    writeFileSync(outputTarget.skippedPath, "");
    this.#outputTarget = outputTarget;
  }

  publishFileReview(fileResult: FileReviewResult): void {
    mkdirSync(path.dirname(fileResult.noteFilePath), { recursive: true });
    writeFileSync(fileResult.noteFilePath, fileResult.content);
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
}
