import type { RunRequest } from "../core/run-request.ts";
import {
  ReviewOrchestrator,
  type ReviewRunSummary
} from "../core/orchestrator.ts";
import { LocalGitProvider } from "../providers/local-git-provider.ts";
import { LocalWorkspaceProvider } from "../providers/local-workspace-provider.ts";

export const LOCAL_REVIEW_RUN_HEADER = "Initialized local review run.";

export interface CreateLocalReviewRunAppOptions {
  workingDirectory: string;
  timestampProvider?: () => string;
}

export interface ReviewApp {
  run(request: RunRequest): Promise<ReviewRunSummary>;
}

export function createLocalReviewRunApp(
  options: CreateLocalReviewRunAppOptions
): ReviewApp {
  const orchestrator = new ReviewOrchestrator({
    sourceProvider: new LocalGitProvider(),
    outputSink: new LocalWorkspaceProvider(),
    workingDirectory: options.workingDirectory,
    timestampProvider: options.timestampProvider
  });

  return {
    async run(request: RunRequest): Promise<ReviewRunSummary> {
      return orchestrator.run(request);
    }
  };
}

export function formatLocalReviewRunSummary(result: ReviewRunSummary): string {
  return [
    LOCAL_REVIEW_RUN_HEADER,
    `Repo root: ${result.repoRoot}`,
    `Output: ${result.outputTarget.basePath}`,
    `Planned files: ${result.plannedFileCount}`
  ].join("\n");
}
