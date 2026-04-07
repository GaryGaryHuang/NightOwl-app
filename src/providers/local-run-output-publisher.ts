import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { OutputTarget } from "../core/review-path-resolver.ts";
import type {
  ChangesetOverviewResult,
  FileReviewResult,
  ReviewIndexResult,
  RunManifestResult,
  RunOutputPublisher,
  RunSummaryResult,
  SkipRecord
} from "./review-output-sink.ts";

/**
 * Run-scoped local artifact publisher bound to one resolved OutputTarget.
 */
export class LocalRunOutputPublisher implements RunOutputPublisher {
  readonly #outputTarget: OutputTarget;

  constructor(outputTarget: OutputTarget) {
    this.#outputTarget = outputTarget;
  }

  publishFileReview(fileResult: FileReviewResult): void {
    mkdirSync(path.dirname(fileResult.noteFilePath), { recursive: true });
    writeFileSync(fileResult.noteFilePath, fileResult.content);
  }

  publishSkippedFile(skipRecord: SkipRecord): void {
    appendFileSync(
      this.#outputTarget.skippedPath,
      `- \`${skipRecord.filePath}\` — ${skipRecord.stepId} — ${skipRecord.reason}\n`
    );
  }

  publishRunSummary(summaryResult: RunSummaryResult): void {
    writeFileSync(this.#outputTarget.summaryPath, summaryResult.content);
  }

  publishReviewIndex(indexResult: ReviewIndexResult): void {
    writeFileSync(this.#outputTarget.indexPath, indexResult.content);
  }

  publishRunManifest(manifestResult: RunManifestResult): void {
    writeFileSync(this.#outputTarget.manifestPath, manifestResult.content);
  }

  publishChangesetOverview(result: ChangesetOverviewResult): void {
    const content = result.content.endsWith("\n")
      ? result.content
      : result.content + "\n";
    writeFileSync(this.#outputTarget.changesetOverviewPath, content);
  }
}