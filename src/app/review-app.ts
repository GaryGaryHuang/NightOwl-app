import path from "node:path";

import type { RunRequest } from "../core/run-request.ts";
import type { RunProgressEventHandler } from "../core/run-progress.ts";
import { ChangesetOverviewRunner } from "../core/changeset-overview-runner.ts";
import {
  ReviewRunInterruptedError,
  type ReviewPerFileStepsFactory,
  type ReviewRunSummary
} from "../core/orchestrator.ts";
import { StepRunner } from "../core/step-runner.ts";
import { LocalGitProvider } from "../providers/local-git-provider.ts";
import {
  LocalReviewSourceSnapshotProvider,
  type ReviewSourceSnapshotProvider
} from "../providers/local-review-source-snapshot-provider.ts";
import { LocalReviewFileFilter } from "../providers/local-review-file-filter.ts";
import { LocalReviewConfigProvider } from "../providers/config/local-review-config-provider.ts";
import { LocalOutputWriteHealthAssessor } from "../providers/local-output-write-health-assessor.ts";
import { LocalWorkspaceProvider } from "../providers/local-workspace-provider.ts";
import type { ReviewConfigProvider } from "../providers/config/review-config-provider.ts";
import type { ReviewFileFilter } from "../providers/review-file-filter.ts";
import type { ReviewOutputSink } from "../providers/review-output-sink.ts";
import type { OutputWriteHealthAssessor } from "../providers/review-output-health-assessor.ts";
import type { ReviewSourceProvider } from "../providers/review-source-provider.ts";
import { KnowledgeSvc } from "../services/knowledge.ts";
import {
  CopilotClientManager,
  type ClientManagerLike
} from "../services/copilot-client-manager.ts";
import type { ToolAuditWriteFailure } from "../services/tool-audit-writer.ts";
import type { WebFetchHostnameClassifier } from "../services/tool-policy/web-fetch-hostname-classifier.ts";
import { DEFAULT_GRACEFUL_SHUTDOWN_TIMEOUT_MS } from "../services/copilot-client-shutdown.ts";
import {
  DryRunRunDepsBuilder,
  ProductionRunDepsBuilder,
  type RunDepsBuilder
} from "./run-deps-builder.ts";
import { RunLifecycleManager } from "./run-lifecycle-manager.ts";

export interface CreateLocalReviewRunAppOptions {
  changesetOverviewRunner?: Pick<ChangesetOverviewRunner, "run">;
  clientManager?: ClientManagerLike;
  context7ApiKey?: string;
  outputSink?: ReviewOutputSink;
  successfulSnapshotOutputHealthAssessor?: OutputWriteHealthAssessor;
  knowledgeSvc?: Pick<KnowledgeSvc, "getMcpServers">;
  reviewConfigProvider?: ReviewConfigProvider;
  reviewFileFilter?: ReviewFileFilter;
  reviewSourceSnapshotProvider?: ReviewSourceSnapshotProvider;
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
 *
 * The repo-root-dependent pieces are assembled inside run() after repo root
 * resolution. Production vs dry-run wiring is delegated to the corresponding
 * RunDepsBuilder so this function stays focused on dependency selection and
 * lifecycle orchestration.
 */
export function createLocalReviewRunApp(
  options: CreateLocalReviewRunAppOptions
): ReviewApp {
  const sharedDefaults = resolveSharedDefaults(options);

  return {
    async run(request: RunRequest): Promise<ReviewRunSummary> {
      const startPath = path.resolve(
        options.workingDirectory,
        request.repoPath ?? "."
      );
      const repoRoot = await sharedDefaults.sourceProvider.resolveRepoRoot(startPath);
      const snapshot = await sharedDefaults.reviewSourceSnapshotProvider.createSnapshot({
        repoRoot,
        baseRef: request.baseRef,
        headRef: request.headRef
      });

      let flush: () => Promise<void> = async () => {};
      let result: ReviewRunSummary | undefined;
      let primaryError: unknown;

      const setupLifecycleManager = new RunLifecycleManager({
        gracefulShutdownTimeoutMs: sharedDefaults.gracefulShutdownTimeoutMs
      });

      try {
        result = await setupLifecycleManager.run(async (signal) => {
          throwIfInterrupted(signal);

          if (snapshot.isDirty) {
            options.onProgressEvent?.({
              type: "run-warning",
              message:
                "Repository has uncommitted changes; review uses the resolved head snapshot, so uncommitted changes are ignored."
            });
          }

          throwIfInterrupted(signal);

          const reviewConfig =
            await sharedDefaults.reviewConfigProvider.loadReviewConfig(
              snapshot.reviewSourceRoot
            );

          throwIfInterrupted(signal);

          const isDryRun = request.dryRun === true;
          const builder = createRunDepsBuilder(isDryRun, options, sharedDefaults, {
            workingDirectory: snapshot.reviewSourceRoot
          });
          const deps = builder.build(reviewConfig);
          flush = deps.flush;

          throwIfInterrupted(signal);

          const reviewSourceRequest: RunRequest = {
            ...request,
            repoPath: "."
          };

          return deps.lifecycleManager.run((runSignal) =>
            deps.orchestrator.run(reviewSourceRequest, {
              signal: runSignal,
              outputRepoRoot: repoRoot,
              sourceBaseRef: snapshot.resolvedBaseRef,
              sourceHeadRef: snapshot.resolvedHeadRef
            })
          );
        });
      } catch (error) {
        primaryError = error;
      }

      try {
        await flush();
      } catch (error) {
        if (primaryError === undefined) {
          primaryError = error;
        } else {
          emitDiagnosticWarning(
            options.onProgressEvent,
            `Output flush failed after primary failure: ${extractErrorMessage(error)}`
          );
        }
      }

      let cleanupError: unknown;
      try {
        await snapshot.cleanup();
      } catch (error) {
        cleanupError = error;
      }

      if (primaryError !== undefined) {
        if (cleanupError !== undefined) {
          emitDiagnosticWarning(
            options.onProgressEvent,
            `Review source snapshot cleanup failed: ${extractErrorMessage(cleanupError)}`
          );
        }
        throw primaryError;
      }

      if (cleanupError !== undefined) {
        throw cleanupError;
      }

      if (result === undefined) {
        throw new Error("Review run completed without a run summary.");
      }

      return result;
    }
  };
}

function throwIfInterrupted(signal: AbortSignal): void {
  if (!signal.aborted) {
    return;
  }

  throw new ReviewRunInterruptedError(extractSignalName(signal.reason));
}

function extractSignalName(reason: unknown): "SIGINT" | "SIGTERM" | undefined {
  if (reason === "SIGINT" || reason === "SIGTERM") {
    return reason;
  }

  return undefined;
}

function emitDiagnosticWarning(
  onProgressEvent: RunProgressEventHandler | undefined,
  message: string
): void {
  try {
    onProgressEvent?.({
      type: "run-warning",
      message
    });
  } catch {
    // Diagnostic warning callbacks must not replace the primary run result.
  }
}

interface SharedDefaults {
  clientManager: ClientManagerLike;
  sourceProvider: ReviewSourceProvider;
  reviewFileFilter: ReviewFileFilter;
  reviewSourceSnapshotProvider: ReviewSourceSnapshotProvider;
  outputSink: ReviewOutputSink;
  successfulSnapshotOutputHealthAssessor: OutputWriteHealthAssessor;
  reviewConfigProvider: ReviewConfigProvider;
  gracefulShutdownTimeoutMs: number;
}

function resolveSharedDefaults(
  options: CreateLocalReviewRunAppOptions
): SharedDefaults {
  return {
    clientManager: options.clientManager ?? new CopilotClientManager(),
    sourceProvider: options.sourceProvider ?? new LocalGitProvider(),
    reviewFileFilter: options.reviewFileFilter ?? new LocalReviewFileFilter(),
    reviewSourceSnapshotProvider:
      options.reviewSourceSnapshotProvider ??
      new LocalReviewSourceSnapshotProvider(),
    outputSink: options.outputSink ?? new LocalWorkspaceProvider(),
    successfulSnapshotOutputHealthAssessor:
      options.successfulSnapshotOutputHealthAssessor ??
      new LocalOutputWriteHealthAssessor(),
    reviewConfigProvider:
      options.reviewConfigProvider ?? new LocalReviewConfigProvider(),
    gracefulShutdownTimeoutMs:
      options.gracefulShutdownTimeoutMs ?? DEFAULT_GRACEFUL_SHUTDOWN_TIMEOUT_MS
  };
}

function createRunDepsBuilder(
  isDryRun: boolean,
  options: CreateLocalReviewRunAppOptions,
  shared: SharedDefaults,
  runOptions: { workingDirectory: string }
): RunDepsBuilder {
  const sharedDeps = {
    changesetOverviewRunner: options.changesetOverviewRunner,
    outputSink: shared.outputSink,
    successfulSnapshotOutputHealthAssessor:
      shared.successfulSnapshotOutputHealthAssessor,
    reviewFileFilter: shared.reviewFileFilter,
    sourceProvider: shared.sourceProvider,
    stepRunner: options.stepRunner,
    workingDirectory: runOptions.workingDirectory,
    timestampProvider: options.timestampProvider,
    onProgressEvent: options.onProgressEvent,
    perFileStepsFactory: options.perFileStepsFactory
  };

  if (isDryRun) {
    return new DryRunRunDepsBuilder({
      ...sharedDeps,
      gracefulShutdownTimeoutMs: shared.gracefulShutdownTimeoutMs
    });
  }

  return new ProductionRunDepsBuilder({
    ...sharedDeps,
    clientManager: shared.clientManager,
    knowledgeSvc: options.knowledgeSvc,
    context7ApiKey: options.context7ApiKey,
    webFetchHostnameClassifier: options.webFetchHostnameClassifier,
    webFetchHostnameClassificationTimeoutMs:
      options.webFetchHostnameClassificationTimeoutMs,
    gracefulShutdownTimeoutMs: shared.gracefulShutdownTimeoutMs,
    onToolAuditWriteFailure: (failure) => {
      options.onProgressEvent?.({
        type: "tool-audit-write-failed",
        message: formatToolAuditWriteFailure(failure)
      });
    }
  });
}

function formatToolAuditWriteFailure(failure: ToolAuditWriteFailure): string {
  const prefix =
    failure.auditFilePath === undefined
      ? "tool-audit.jsonl write failed"
      : `tool-audit.jsonl write failed at ${failure.auditFilePath}`;

  return `${prefix}: ${extractErrorMessage(failure.error)}`;
}

function extractErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
