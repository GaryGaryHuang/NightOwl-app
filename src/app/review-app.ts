import path from "node:path";

import type { RunRequest } from "../core/run-request.ts";
import type { RunProgressEventHandler } from "../core/run-progress.ts";
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
import { LocalReviewFileFilter } from "../providers/local-review-file-filter.ts";
import { LocalReviewConfigProvider } from "../providers/local-review-config-provider.ts";
import { LocalSuccessfulSnapshotOutputHealthAssessor } from "../providers/local-successful-snapshot-output-health-assessor.ts";
import { LocalWorkspaceProvider } from "../providers/local-workspace-provider.ts";
import type { ReviewConfigProvider } from "../providers/review-config-provider.ts";
import type { ReviewFileFilter } from "../providers/review-file-filter.ts";
import type {
  ReviewOutputSink,
  SuccessfulSnapshotOutputHealthAssessor
} from "../providers/review-output-sink.ts";
import type { ReviewSourceProvider } from "../providers/review-source-provider.ts";
import { JudgeSessionFactory } from "../services/judge-session-factory.ts";
import { KnowledgeSvc } from "../services/knowledge.ts";
import {
  CopilotClientManager,
  type CopilotClientLike
} from "../services/session-executor.ts";
import { ReviewSessionFactory } from "../services/review-session-factory.ts";
import { ToolPolicyGuard } from "../services/tool-policy-guard.ts";
import { ToolAuditWriter } from "../services/tool-audit-writer.ts";
import type { WebFetchHostnameClassifier } from "../services/web-fetch-hostname-classifier.ts";
import {
  DryRunReviewSessionFactory,
  DryRunJudgeSessionFactory
} from "../services/dry-run-session-factory.ts";
import {
  DEFAULT_GRACEFUL_SHUTDOWN_TIMEOUT_MS,
  stopClientManagerWithTimeout
} from "../services/copilot-client-shutdown.ts";

export const LOCAL_REVIEW_RUN_HEADER = "Review run completed.";

export interface CreateLocalReviewRunAppOptions {
  changesetOverviewRunner?: Pick<ChangesetOverviewRunner, "run">;
  clientManager?: {
    start(): Promise<void>;
    stop(): Promise<void>;
    forceStop(): Promise<void>;
    getClient(): CopilotClientLike;
  };
  outputSink?: ReviewOutputSink;
  successfulSnapshotOutputHealthAssessor?: SuccessfulSnapshotOutputHealthAssessor;
  knowledgeSvc?: Pick<KnowledgeSvc, "getMcpServers">;
  reviewConfigProvider?: ReviewConfigProvider;
  reviewFileFilter?: ReviewFileFilter;
  sourceProvider?: ReviewSourceProvider;
  stepRunner?: Pick<StepRunner, "run">;
  workingDirectory: string;
  timestampProvider?: () => string;
  gracefulShutdownTimeoutMs?: number;
  webFetchHostnameClassifier?: WebFetchHostnameClassifier;
  webFetchHostnameClassificationTimeoutMs?: number;
  onProgressEvent?: RunProgressEventHandler;
}

type LocalReviewRunClientManager = NonNullable<
  CreateLocalReviewRunAppOptions["clientManager"]
>;

export interface ReviewApp {
  run(request: RunRequest): Promise<ReviewRunSummary>;
}

/**
 * Composition root for a single local review run.
 * The repo-root-dependent pieces are assembled inside run() after repo root resolution.
 */
export function createLocalReviewRunApp(
  options: CreateLocalReviewRunAppOptions
): ReviewApp {
  const clientManager = options.clientManager ?? new CopilotClientManager();
  const gracefulShutdownTimeoutMs =
    options.gracefulShutdownTimeoutMs ?? DEFAULT_GRACEFUL_SHUTDOWN_TIMEOUT_MS;
  const sourceProvider = options.sourceProvider ?? new LocalGitProvider();
  const reviewFileFilter =
    options.reviewFileFilter ?? new LocalReviewFileFilter();
  const outputSink = options.outputSink ?? new LocalWorkspaceProvider();
  const successfulSnapshotOutputHealthAssessor =
    options.successfulSnapshotOutputHealthAssessor ??
    new LocalSuccessfulSnapshotOutputHealthAssessor();
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

      // In dry-run mode substitute stub factories so no Copilot CLI or AI calls are made.
      const isDryRun = request.dryRun === true;

      const auditWriterHolder: { current?: ToolAuditWriter } = {};

      const reviewSessionFactory: Pick<
        ReviewSessionFactory,
        "createSession"
      > = isDryRun
        ? new DryRunReviewSessionFactory()
        : (() => {
            const knowledgeSvc =
              options.knowledgeSvc ??
              new KnowledgeSvc({
                context7ApiKey: process.env.CONTEXT7_API_KEY,
                userMcpServers: reviewConfig.mcpServers
              });
            const toolPolicyGuard = new ToolPolicyGuard({
              hostnameClassifier: options.webFetchHostnameClassifier,
              webFetchAllowedHosts: reviewConfig.webFetchAllowedHosts,
              webFetchDeniedHosts: reviewConfig.webFetchDeniedHosts,
              webFetchHostnameClassificationTimeoutMs:
                options.webFetchHostnameClassificationTimeoutMs
            });
            return new ReviewSessionFactory({
              clientManager,
              knowledgeSvc,
              toolPolicyGuard,
              auditWriterProvider: () => auditWriterHolder.current
            });
          })();

      const effectiveJudgeService = isDryRun
        ? new JudgeService({ judgeSessionFactory: new DryRunJudgeSessionFactory() })
        : judgeService;

      const changesetOverviewRunner =
        options.changesetOverviewRunner ??
        new ChangesetOverviewRunner({
          reviewSessionFactory
        });
      const stepRunner =
        options.stepRunner ??
        new StepRunner({
          reviewSessionFactory,
          judgeService: effectiveJudgeService,
          structuredOutputValidator: new StructuredOutputValidator({
            confidenceThresholds: reviewConfig.confidenceThresholds
          })
        });
      const orchestrator = new ReviewOrchestrator({
        changesetOverviewRunner,
        reviewFileFilter,
        sourceProvider,
        outputSink,
        successfulSnapshotOutputHealthAssessor,
        stepRunner,
        workingDirectory: options.workingDirectory,
        timestampProvider: options.timestampProvider,
        maxConcurrentFiles: reviewConfig.maxConcurrentFiles,
        onProgressEvent: options.onProgressEvent,
        onOutputTargetReady: (outputTarget) => {
          // Wire the audit writer only after the run output path exists; Step 0 sessions created earlier are not audited.
          const auditWriter = new ToolAuditWriter(outputTarget.toolAuditPath);
          auditWriterHolder.current = auditWriter;
        }
      });

      if (!isDryRun) {
        await clientManager.start();
      }

      // Translate process signals into a shared AbortSignal so the orchestrator can stop cooperatively.
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
        if (!isDryRun) {
          await stopClientManagerWithTimeout(clientManager, gracefulShutdownTimeoutMs);
        }
      }
    }
  };
}

export function formatLocalReviewRunSummary(result: ReviewRunSummary): string {
  const header = result.dryRun
    ? `[DRY RUN] ${LOCAL_REVIEW_RUN_HEADER}`
    : LOCAL_REVIEW_RUN_HEADER;
  const lines = [
    header,
    `Planned files: ${result.plannedFileCount}`,
    `Successful files: ${result.successfulFileCount}`,
    `Skipped files: ${result.skippedFileCount}`
  ];

  if (result.finalizerFailures.length > 0) {
    const artifacts = result.finalizerFailures.map((f) => f.artifact).join(", ");
    lines.push(`Warning: Failed to write run-level artifacts: ${artifacts}`);
  }

  return lines.join("\n");
}
