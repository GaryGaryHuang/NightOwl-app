import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  ReviewOutputSink,
  ReviewOutputTarget,
  RunOutputPublisher
} from "../../src/providers/review-output-sink.ts";

export type ReviewOutputBootstrapAndPublisher =
  ReviewOutputSink & RunOutputPublisher;

export function defineOutputSinkDouble(
  sink: ReviewOutputBootstrapAndPublisher
): ReviewOutputBootstrapAndPublisher {
  return sink;
}

export function createWritableOutputSink(): ReviewOutputBootstrapAndPublisher {
  let outputTarget: ReviewOutputTarget;

  const sink: ReviewOutputBootstrapAndPublisher = {
    async initializeRun(target: ReviewOutputTarget): Promise<RunOutputPublisher> {
      await mkdir(target.basePath, { recursive: true });
      await mkdir(target.filesPath, { recursive: true });
      await writeFile(target.skippedPath, "");
      outputTarget = target;
      return sink;
    },

    async publishFileReview(fileResult) {
      await mkdir(path.dirname(fileResult.noteFilePath), { recursive: true });
      await writeFile(fileResult.noteFilePath, fileResult.content);
    },

    async publishSkippedFile(skipRecord) {
      await appendFile(
        outputTarget.skippedPath,
        `- \`${skipRecord.filePath}\` — ${skipRecord.stepId} — ${skipRecord.reason}\n`
      );
    },

    async publishRunSummary(summaryResult) {
      await writeFile(outputTarget.summaryPath, summaryResult.content);
    },

    async publishReviewIndex(indexResult) {
      await writeFile(outputTarget.indexPath, indexResult.content);
    },

    async publishRunManifest(manifestResult) {
      await writeFile(outputTarget.manifestPath, manifestResult.content);
    },

    async publishChangesetOverview(result) {
      await writeFile(outputTarget.changesetOverviewPath, result.content);
    }
  };

  return sink;
}
