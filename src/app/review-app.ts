import path from "node:path";

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
import { LocalReviewConfigProvider } from "../providers/local-review-config-provider.ts";
import { LocalWorkspaceProvider } from "../providers/local-workspace-provider.ts";
import type { ReviewConfigProvider } from "../providers/review-config-provider.ts";
import type { ReviewOutputSink } from "../providers/review-output-sink.ts";
import type { ReviewSourceProvider } from "../providers/review-source-provider.ts";
import { JudgeSessionFactory } from "../services/judge-session-factory.ts";
import { KnowledgeSvc } from "../services/knowledge.ts";
import {
  CopilotClientManager,
  type CopilotClientLike
} from "../services/session-executor.ts";
import { ReviewSessionFactory } from "../services/review-session-factory.ts";
import { ToolAuditWriter } from "../services/tool-audit-writer.ts";

export const LOCAL_REVIEW_RUN_HEADER = "Initialized local review run.";
const DEFAULT_GRACEFUL_SHUTDOWN_TIMEOUT_MS = 5000;
const STOP_TIMEOUT_EXCEEDED = Symbol("stop-timeout-exceeded");

export interface CreateLocalReviewRunAppOptions {
  changesetOverviewRunner?: Pick<ChangesetOverviewRunner, "run">;
  clientManager?: {
    start(): Promise<void>;
    stop(): Promise<void>;
    forceStop(): Promise<void>;
    getClient(): CopilotClientLike;
  };
  outputSink?: ReviewOutputSink;
  knowledgeSvc?: Pick<KnowledgeSvc, "getMcpServers">;
  reviewConfigProvider?: ReviewConfigProvider;
  sourceProvider?: ReviewSourceProvider;
  stepRunner?: Pick<StepRunner, "run">;
  workingDirectory: string;
  timestampProvider?: () => string;
  gracefulShutdownTimeoutMs?: number;
}

type LocalReviewRunClientManager = NonNullable<
  CreateLocalReviewRunAppOptions["clientManager"]
>;

export interface ReviewApp {
  run(request: RunRequest): Promise<ReviewRunSummary>;
}

export function createLocalReviewRunApp(
  options: CreateLocalReviewRunAppOptions
): ReviewApp {
  const clientManager = options.clientManager ?? new CopilotClientManager();
  const gracefulShutdownTimeoutMs =
    options.gracefulShutdownTimeoutMs ?? DEFAULT_GRACEFUL_SHUTDOWN_TIMEOUT_MS;
  const sourceProvider = options.sourceProvider ?? new LocalGitProvider();
  const outputSink = options.outputSink ?? new LocalWorkspaceProvider();
  const reviewConfigProvider =
    options.reviewConfigProvider ?? new LocalReviewConfigProvider();
  const judgeSessionFactory = new JudgeSessionFactory({ clientManager });
  const judgeService = new JudgeService({ judgeSessionFactory });

  return {
    async run(request: RunRequest): Promise<ReviewRunSummary> {
      const startPath = path.resolve(
        options.workingDirectory,
        request.repoPath ?? "."
      );
      const repoRoot = sourceProvider.resolveRepoRoot(startPath);
      const reviewConfig = reviewConfigProvider.loadReviewConfig(repoRoot);
      const knowledgeSvc =
        options.knowledgeSvc ??
        new KnowledgeSvc({
          context7ApiKey: process.env.CONTEXT7_API_KEY,
          userMcpServers: reviewConfig.mcpServers
        });
      const reviewSessionFactory = new ReviewSessionFactory({
        clientManager,
        knowledgeSvc,
        webFetchAllowedHosts: reviewConfig.webFetchAllowedHosts,
        webFetchDeniedHosts: reviewConfig.webFetchDeniedHosts
      });
      const changesetOverviewRunner =
        options.changesetOverviewRunner ??
        new ChangesetOverviewRunner({
          reviewSessionFactory
        });
      const stepRunner =
        options.stepRunner ??
        new StepRunner({
          reviewSessionFactory,
          judgeService,
          structuredOutputValidator: new StructuredOutputValidator({
            confidenceThresholds: reviewConfig.confidenceThresholds
          })
        });
      const orchestrator = new ReviewOrchestrator({
        changesetOverviewRunner,
        sourceProvider,
        outputSink,
        stepRunner,
        workingDirectory: options.workingDirectory,
        timestampProvider: options.timestampProvider,
        maxConcurrentFiles: reviewConfig.maxConcurrentFiles,
        onOutputTargetReady: (outputTarget) => {
          const auditWriter = new ToolAuditWriter(outputTarget.toolAuditPath);
          reviewSessionFactory.setAuditWriter(auditWriter);
        }
      });

      await clientManager.start();

      const controller = new AbortController();
      const handleSigint = (): void => {
        controller.abort("SIGINT");
      };
      const handleSigterm = (): void => {
        controller.abort("SIGTERM");
      };

      process.on("SIGINT", handleSigint);
      process.on("SIGTERM", handleSigterm);

      try {
        return await orchestrator.run(request, { signal: controller.signal });
      } finally {
        // Remove handlers before stop() to prevent double-fire from SIGTERM during SDK teardown.
        process.off("SIGINT", handleSigint);
        process.off("SIGTERM", handleSigterm);
        await stopClientManagerWithTimeout(clientManager, gracefulShutdownTimeoutMs);
      }
    }
  };
}

async function stopClientManagerWithTimeout(
  clientManager: LocalReviewRunClientManager,
  timeoutMs: number
): Promise<void> {
  const stopPromise = clientManager.stop();
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  let stopResult: void | typeof STOP_TIMEOUT_EXCEEDED = undefined;

  try {
    stopResult = await Promise.race([
      stopPromise.then(() => undefined),
      new Promise<typeof STOP_TIMEOUT_EXCEEDED>((resolve) => {
        timeoutHandle = setTimeout(() => {
          resolve(STOP_TIMEOUT_EXCEEDED);
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }

  if (stopResult !== STOP_TIMEOUT_EXCEEDED) {
    return;
  }

  // stop() may still settle after timeout; handle that late rejection while forceStop() takes over.
  void stopPromise.catch(() => {});
  await clientManager.forceStop();
}

export function formatLocalReviewRunSummary(result: ReviewRunSummary): string {
  return [
    LOCAL_REVIEW_RUN_HEADER,
    `Repo root: ${result.repoRoot}`,
    `Output: ${result.outputTarget.basePath}`,
    `Files: ${result.outputTarget.filesPath}`,
    `Summary: ${result.outputTarget.summaryPath}`,
    `Index: ${result.outputTarget.indexPath}`,
    `Manifest: ${result.outputTarget.manifestPath}`,
    `Tool Audit: ${result.outputTarget.toolAuditPath}`,
    `Skipped: ${result.outputTarget.skippedPath}`,
    `Planned files: ${result.plannedFileCount}`,
    `Successful files: ${result.successfulFileCount}`,
    `Skipped files: ${result.skippedFileCount}`
  ].join("\n");
}
