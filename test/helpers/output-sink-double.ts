import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import type {
  ReviewOutputBootstrapAndPublisher,
  ReviewOutputTarget,
  RunOutputPublisher
} from "../../src/providers/review-output-sink.ts";

export function defineOutputSinkDouble(
  sink: ReviewOutputBootstrapAndPublisher
): ReviewOutputBootstrapAndPublisher {
  return sink;
}

export function createWritableOutputSink(): ReviewOutputBootstrapAndPublisher {
  let outputTarget: ReviewOutputTarget;

  const sink: ReviewOutputBootstrapAndPublisher = {
    initializeRun(target: ReviewOutputTarget): RunOutputPublisher {
      mkdirSync(target.basePath, { recursive: true });
      mkdirSync(target.filesPath, { recursive: true });
      writeFileSync(target.skippedPath, "");
      outputTarget = target;
      return sink;
    },

    publishFileReview(fileResult) {
      mkdirSync(path.dirname(fileResult.noteFilePath), { recursive: true });
      writeFileSync(fileResult.noteFilePath, fileResult.content);
    },

    publishSkippedFile(skipRecord) {
      appendFileSync(
        outputTarget.skippedPath,
        `- \`${skipRecord.filePath}\` — ${skipRecord.stepId} — ${skipRecord.reason}\n`
      );
    },

    publishRunSummary(summaryResult) {
      writeFileSync(outputTarget.summaryPath, summaryResult.content);
    },

    publishReviewIndex(indexResult) {
      writeFileSync(outputTarget.indexPath, indexResult.content);
    },

    publishRunManifest(manifestResult) {
      writeFileSync(outputTarget.manifestPath, manifestResult.content);
    },

    publishChangesetOverview(result) {
      writeFileSync(outputTarget.changesetOverviewPath, result.content);
    }
  };

  return sink;
}
