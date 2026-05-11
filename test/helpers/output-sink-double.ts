import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  ReviewArtifactKind,
  ReviewOutputPlan,
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
  let outputPlan: ReviewOutputPlan;
  let notePathByFilePath = new Map<string, string>();

  const sink: ReviewOutputBootstrapAndPublisher = {
    async initializeRun(plan: ReviewOutputPlan): Promise<RunOutputPublisher> {
      await mkdir(plan.outputTarget.basePath, { recursive: true });
      await mkdir(plan.outputTarget.filesPath, { recursive: true });
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

    async publishArtifact(kind: ReviewArtifactKind, result) {
      const pathMap: Record<ReviewArtifactKind, string> = {
        "changeset-overview": outputPlan.outputTarget.changesetOverviewPath,
        "index": outputPlan.outputTarget.indexPath
      };
      await writeFile(pathMap[kind], result.content);
    }
  };

  return sink;
}
