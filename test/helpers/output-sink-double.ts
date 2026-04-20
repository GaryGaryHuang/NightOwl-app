import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  ReviewOutputPlan,
  ReviewOutputSink,
  RunOutputPublisher
} from "../../src/providers/review-output-sink.ts";
import { formatSkippedFileRecord } from "../../src/providers/review-output-sink.ts";

export type ReviewOutputBootstrapAndPublisher =
  ReviewOutputSink & RunOutputPublisher;

export function defineOutputSinkDouble(
  sink: ReviewOutputBootstrapAndPublisher
): ReviewOutputBootstrapAndPublisher {
  return sink;
}

export function createWritableOutputSink(): ReviewOutputBootstrapAndPublisher {
  let outputPlan: ReviewOutputPlan;
  let notePathByFilePath = new Map<string, string>();

  const sink: ReviewOutputBootstrapAndPublisher = {
    async initializeRun(plan: ReviewOutputPlan): Promise<RunOutputPublisher> {
      await mkdir(plan.outputTarget.basePath, { recursive: true });
      await mkdir(plan.outputTarget.filesPath, { recursive: true });
      await writeFile(plan.outputTarget.skippedPath, "");
      outputPlan = plan;
      notePathByFilePath = new Map(
        plan.plannedNotes.map((plannedNote) => [
          plannedNote.filePath,
          plannedNote.noteFilePath
        ])
      );
      return sink;
    },

    async publishFileReview(fileResult) {
      const noteFilePath = notePathByFilePath.get(fileResult.filePath);
      if (!noteFilePath) {
        throw new Error(`Missing planned note for ${fileResult.filePath}`);
      }

      await mkdir(path.dirname(noteFilePath), { recursive: true });
      await writeFile(noteFilePath, fileResult.content);
    },

    async publishSkippedFile(skipRecord) {
      await appendFile(
        outputPlan.outputTarget.skippedPath,
        formatSkippedFileRecord(skipRecord)
      );
    },

    async publishRunSummary(summaryResult) {
      await writeFile(outputPlan.outputTarget.summaryPath, summaryResult.content);
    },

    async publishReviewIndex(indexResult) {
      await writeFile(outputPlan.outputTarget.indexPath, indexResult.content);
    },

    async publishVerifierReport(result) {
      await writeFile(outputPlan.outputTarget.verifierReportPath, result.content);
    },

    async publishRunManifest(manifestResult) {
      await writeFile(outputPlan.outputTarget.manifestPath, manifestResult.content);
    },

    async publishChangesetOverview(result) {
      await writeFile(outputPlan.outputTarget.changesetOverviewPath, result.content);
    }
  };

  return sink;
}
