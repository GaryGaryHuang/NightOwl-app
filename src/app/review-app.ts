import path from "node:path";

import type { RunRequest } from "../core/run-request.ts";
import type { RunProgressEventHandler } from "../core/run-progress.ts";
import {
  ChangesetOverviewRunner
} from "../core/changeset-overview-runner.ts";
import {
  ReviewOrchestrator,
  type ReviewPerFileStepsFactory,
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
import type { ReviewOutputSink } from "../providers/review-output-sink.ts";
import type { SuccessfulSnapshotOutputHealthAssessor } from "../providers/review-output-health-assessor.ts";
import type { ReviewSourceProvider } from "../providers/review-source-provider.ts";
import { JudgeSessionFactory } from "../services/judge-session-factory.ts";
import { KnowledgeSvc } from "../services/knowledge.ts";
import {
  CopilotClientManager,
  type ClientManagerLike
} from "../services/session-executor.ts";
import { ReviewSessionFactory } from "../services/review-session-factory.ts";
import { ToolPolicyGuard } from "../services/tool-policy-guard.ts";
import { ToolAuditWriter } from "../services/tool-audit-writer.ts";
import type { WebFetchHostnameClassifier } from "../services/web-fetch-hostname-classifier.ts";
import {
  DryRunReviewSessionFactory
} from "../services/dry-run-review-session-factory.ts";
import {
  DryRunJudgeSessionFactory
} from "../services/dry-run-judge-session-factory.ts";
import {
  DEFAULT_GRACEFUL_SHUTDOWN_TIMEOUT_MS
} from "../services/copilot-client-shutdown.ts";
import { RunLifecycleManager } from "./run-lifecycle-manager.ts";

export const LOCAL_REVIEW_RUN_HEADER = "Review run completed.";

export interface CreateLocalReviewRunAppOptions {
  changesetOverviewRunner?: Pick<ChangesetOverviewRunner, "run">;
  clientManager?: ClientManagerLike;
  context7ApiKey?: string;
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
  perFileStepsFactory?: ReviewPerFileStepsFactory;
}

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

  return {
    async run(request: RunRequest): Promise<ReviewRunSummary> {
      const startPath = path.resolve(
        options.workingDirectory,
        request.repoPath ?? "."
      );
      const repoRoot = await sourceProvider.resolveRepoRoot(startPath);
      const reviewConfig = await reviewConfigProvider.loadReviewConfig(repoRoot);

      // In dry-run mode substitute stub factories so no Copilot CLI or AI calls are made.
      const isDryRun = request.dryRun === true;

      // judgeSessionFactory and judgeService are request-scoped: built after isDryRun is known.
      const judgeSessionFactory = isDryRun
        ? new DryRunJudgeSessionFactory()
        : new JudgeSessionFactory({ clientManager });
      const judgeService = new JudgeService({ judgeSessionFactory });

      let reviewSessionFactory: Pick<ReviewSessionFactory, "createSession">;
      let onOutputTargetReady: ((outputTarget: { toolAuditPath: string }) => void) | undefined;

      if (isDryRun) {
        reviewSessionFactory = new DryRunReviewSessionFactory();
      } else {
        const auditWriter = new ToolAuditWriter();
        const knowledgeSvc =
          options.knowledgeSvc ??
          new KnowledgeSvc({
            context7ApiKey: options.context7ApiKey ?? process.env.CONTEXT7_API_KEY,
            userMcpServers: reviewConfig.mcpServers
          });
        const toolPolicyGuard = new ToolPolicyGuard({
          hostnameClassifier: options.webFetchHostnameClassifier,
          webFetchAllowedHosts: reviewConfig.webFetchAllowedHosts,
          webFetchDeniedHosts: reviewConfig.webFetchDeniedHosts,
          webFetchHostnameClassificationTimeoutMs:
            options.webFetchHostnameClassificationTimeoutMs
        });
        reviewSessionFactory = new ReviewSessionFactory({
          clientManager,
          knowledgeSvc,
          toolPolicyGuard,
          auditWriterProvider: () => auditWriter
        });
        onOutputTargetReady = (outputTarget) => {
          auditWriter.setPath(outputTarget.toolAuditPath);
        };
      }

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
        reviewFileFilter,
        sourceProvider,
        outputSink,
        successfulSnapshotOutputHealthAssessor,
        stepRunner,
        workingDirectory: options.workingDirectory,
        timestampProvider: options.timestampProvider,
        maxConcurrentFiles: reviewConfig.maxConcurrentFiles,
        perFileStepsFactory: options.perFileStepsFactory,
        onProgressEvent: options.onProgressEvent,
        onOutputTargetReady
      });

      const lifecycleManager = new RunLifecycleManager({
        clientManager: isDryRun ? undefined : clientManager,
        gracefulShutdownTimeoutMs
      });

      return await lifecycleManager.run((signal) =>
        orchestrator.run(request, { signal })
      );
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
