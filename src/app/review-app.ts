import type { RunRequest } from "../core/run-request.ts";
import {
  ChangesetOverviewRunner
} from "../core/changeset-overview-runner.ts";
import {
  ReviewOrchestrator,
  type ReviewRunSummary
} from "../core/orchestrator.ts";
import { JudgeService } from "../core/judge.ts";
import { StepRunner } from "../core/step-runner.ts";
import { StructuredOutputValidator } from "../core/structured-output-validator.ts";
import { LocalGitProvider } from "../providers/local-git-provider.ts";
import { LocalWorkspaceProvider } from "../providers/local-workspace-provider.ts";
import type { ReviewOutputSink } from "../providers/review-output-sink.ts";
import type { ReviewSourceProvider } from "../providers/review-source-provider.ts";
import { JudgeSessionFactory } from "../services/judge-session-factory.ts";
import {
  CopilotClientManager,
  type CopilotClientLike
} from "../services/session-executor.ts";
import { ReviewSessionFactory } from "../services/review-session-factory.ts";

export const LOCAL_REVIEW_RUN_HEADER = "Initialized local review run.";

export interface CreateLocalReviewRunAppOptions {
  changesetOverviewRunner?: Pick<ChangesetOverviewRunner, "run">;
  clientManager?: {
    start(): Promise<void>;
    stop(): Promise<void>;
    getClient(): CopilotClientLike;
  };
  outputSink?: ReviewOutputSink;
  sourceProvider?: ReviewSourceProvider;
  stepRunner?: Pick<StepRunner, "run">;
  workingDirectory: string;
  timestampProvider?: () => string;
}

export interface ReviewApp {
  run(request: RunRequest): Promise<ReviewRunSummary>;
}

export function createLocalReviewRunApp(
  options: CreateLocalReviewRunAppOptions
): ReviewApp {
  const clientManager = options.clientManager ?? new CopilotClientManager();
  const sourceProvider = options.sourceProvider ?? new LocalGitProvider();
  const outputSink = options.outputSink ?? new LocalWorkspaceProvider();
  const reviewSessionFactory = new ReviewSessionFactory({ clientManager });
  const judgeSessionFactory = new JudgeSessionFactory({ clientManager });
  const judgeService = new JudgeService({ judgeSessionFactory });
  const structuredOutputValidator = new StructuredOutputValidator();
  const stepRunner =
    options.stepRunner ??
    new StepRunner({
      reviewSessionFactory,
      judgeService,
      structuredOutputValidator
    });
  const changesetOverviewRunner =
    options.changesetOverviewRunner ??
    new ChangesetOverviewRunner({
      reviewSessionFactory
    });
  const orchestrator = new ReviewOrchestrator({
    changesetOverviewRunner,
    sourceProvider,
    outputSink,
    stepRunner,
    workingDirectory: options.workingDirectory,
    timestampProvider: options.timestampProvider
  });

  return {
    async run(request: RunRequest): Promise<ReviewRunSummary> {
      await clientManager.start();

      try {
        return await orchestrator.run(request);
      } finally {
        await clientManager.stop();
      }
    }
  };
}

export function formatLocalReviewRunSummary(result: ReviewRunSummary): string {
  return [
    LOCAL_REVIEW_RUN_HEADER,
    `Repo root: ${result.repoRoot}`,
    `Output: ${result.outputTarget.basePath}`,
    `Files: ${result.outputTarget.filesPath}`,
    `Summary: ${result.outputTarget.summaryPath}`,
    `Index: ${result.outputTarget.indexPath}`,
    `Skipped: ${result.outputTarget.skippedPath}`,
    `Planned files: ${result.plannedFileCount}`,
    `Successful files: ${result.successfulFileCount}`,
    `Skipped files: ${result.skippedFileCount}`
  ].join("\n");
}
