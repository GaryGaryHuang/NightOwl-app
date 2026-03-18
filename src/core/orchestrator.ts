import path from "node:path";

import type { RunRequest } from "./run-request.ts";
import {
  buildOutputTarget,
  planNoteFiles,
  type OutputTarget
} from "./review-path-resolver.ts";
import type { ReviewOutputSink } from "../providers/review-output-sink.ts";
import type { ReviewSourceProvider } from "../providers/review-source-provider.ts";

export interface ReviewRunSummary {
  repoRoot: string;
  outputTarget: OutputTarget;
  plannedFileCount: number;
}

export interface ReviewOrchestratorOptions {
  sourceProvider: ReviewSourceProvider;
  outputSink: ReviewOutputSink;
  workingDirectory: string;
  timestampProvider?: () => string;
}

export class ReviewOrchestrator {
  readonly #sourceProvider: ReviewSourceProvider;
  readonly #outputSink: ReviewOutputSink;
  readonly #workingDirectory: string;
  readonly #timestampProvider: () => string;

  constructor(options: ReviewOrchestratorOptions) {
    this.#sourceProvider = options.sourceProvider;
    this.#outputSink = options.outputSink;
    this.#workingDirectory = options.workingDirectory;
    this.#timestampProvider = options.timestampProvider ?? defaultTimestampProvider;
  }

  async run(request: RunRequest): Promise<ReviewRunSummary> {
    const startPath = path.resolve(this.#workingDirectory, request.repoPath ?? ".");
    const repoRoot = this.#sourceProvider.resolveRepoRoot(startPath);
    const branchName = this.#sourceProvider.getCurrentBranch(repoRoot);
    const changedFiles = this.#sourceProvider.getChangedFiles(
      repoRoot,
      request.baseRef,
      request.headRef
    );
    const reviewableFiles = this.#sourceProvider.filterIgnoredFiles(
      repoRoot,
      changedFiles
    );
    const outputTarget = buildOutputTarget({
      outputBaseDir: startPath,
      branchName,
      headRef: request.headRef,
      timestamp: this.#timestampProvider()
    });
    const plannedNoteFiles = planNoteFiles(outputTarget.filesPath, reviewableFiles);

    this.#outputSink.initializeRun(outputTarget);

    for (const plannedNote of plannedNoteFiles) {
      this.#outputSink.publishFileReview({
        noteFilePath: plannedNote.noteFilePath,
        content: renderBootstrapNote(plannedNote.filePath)
      });
    }

    return {
      repoRoot,
      outputTarget,
      plannedFileCount: plannedNoteFiles.length
    };
  }
}

function renderBootstrapNote(filePath: string): string {
  return [
    `# ${filePath}`,
    "",
    `- Source file: \`${filePath}\``,
    "- Status: Review not yet generated."
  ].join("\n");
}

function defaultTimestampProvider(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hour = String(now.getHours()).padStart(2, "0");
  const minute = String(now.getMinutes()).padStart(2, "0");

  return `${month}${day}${hour}${minute}`;
}
