import type { RunProgressEventHandler } from "../core/run-progress.ts";
import {
  ChangesetOverviewRunner
} from "../core/changeset-overview-runner.ts";
import {
  buildDefaultPerFileSteps,
  ReviewOrchestrator,
  type ReviewPerFileStepsFactory
} from "../core/orchestrator.ts";
import { StepRunner } from "../core/step-runner.ts";
import type { ReviewConfig } from "../providers/config/review-config-provider.ts";
import type { ReviewFileFilter } from "../providers/review-file-filter.ts";
import type { ReviewOutputSink } from "../providers/review-output-sink.ts";
import type { OutputWriteHealthAssessor } from "../providers/review-output-health-assessor.ts";
import type { ReviewSourceProvider } from "../providers/review-source-provider.ts";
import { KnowledgeSvc } from "../services/knowledge.ts";
import {
  type ClientManagerLike
} from "../services/copilot-client-manager.ts";
import { ReviewSessionFactory } from "../services/review-session-factory.ts";
import { ToolPolicyGuard } from "../services/tool-policy/tool-policy-guard.ts";
import {
  ReviewRunToolAudit,
  type ToolAuditWriteFailure,
  type ToolAuditOutputTarget,
  type ToolAuditSink
} from "../services/tool-audit-writer.ts";
import { resolveReviewSessionModelProvider } from "../services/review-model-provider-resolver.ts";
import type { WebFetchHostnameClassifier } from "../services/tool-policy/web-fetch-hostname-classifier.ts";
import {
  DryRunReviewSessionFactory
} from "../services/dry-run-review-session-factory.ts";
import { RunLifecycleManager } from "./run-lifecycle-manager.ts";
import { CHANGESET_OVERVIEW_STEP_ID } from "../core/review-step-ids.ts";

export interface RunDeps {
  orchestrator: ReviewOrchestrator;
  lifecycleManager: RunLifecycleManager;
  flush(): Promise<void>;
}

export interface RunDepsSharedOptions {
  changesetOverviewRunner?: Pick<ChangesetOverviewRunner, "run">;
  outputSink: ReviewOutputSink;
  successfulSnapshotOutputHealthAssessor: OutputWriteHealthAssessor;
  reviewFileFilter: ReviewFileFilter;
  sourceProvider: ReviewSourceProvider;
  stepRunner?: Pick<StepRunner, "run">;
  workingDirectory: string;
  timestampProvider?: () => string;
  onProgressEvent?: RunProgressEventHandler;
  perFileStepsFactory?: ReviewPerFileStepsFactory;
}

export interface ProductionRunDepsBuilderOptions extends RunDepsSharedOptions {
  clientManager: ClientManagerLike;
  context7ApiKey?: string;
  webFetchHostnameClassifier?: WebFetchHostnameClassifier;
  onToolAuditWriteFailure?: (failure: ToolAuditWriteFailure) => void;
}

interface ToolAuditLifecycle {
  auditWriterProvider?: () => ToolAuditSink | undefined;
  onOutputTargetReady?: (outputTarget: ToolAuditOutputTarget) => void;
  onRunLevelFailureOutputTargetReady?: (
    outputTarget: ToolAuditOutputTarget
  ) => Promise<void>;
  flush(): Promise<void>;
}

export class ProductionRunDepsBuilder {
  readonly #options: ProductionRunDepsBuilderOptions;

  constructor(options: ProductionRunDepsBuilderOptions) {
    this.#options = options;
  }

  build(reviewConfig: ReviewConfig): RunDeps {
    const options = this.#options;
    const toolAuditLifecycle = createProductionToolAuditLifecycle(
      options.onToolAuditWriteFailure
    );
    const knowledgeSvc = new KnowledgeSvc({
      context7ApiKey: options.context7ApiKey ?? process.env.CONTEXT7_API_KEY,
      userMcpServers: reviewConfig.mcpServers
    });
    const toolPolicyGuard = new ToolPolicyGuard({
      hostnameClassifier: options.webFetchHostnameClassifier,
      webFetchAllowedHosts: reviewConfig.webFetchAllowedHosts,
      webFetchDeniedHosts: reviewConfig.webFetchDeniedHosts
    });
    const reviewSessionFactory = new ReviewSessionFactory({
      clientManager: options.clientManager,
      knowledgeSvc,
      modelProvider: resolveReviewSessionModelProvider(
        reviewConfig.modelProvider
      ),
      toolPolicyGuard,
      auditWriterProvider: toolAuditLifecycle.auditWriterProvider
    });

    const orchestrator = buildOrchestrator({
      shared: options,
      reviewConfig,
      reviewSessionFactory,
      onOutputTargetReady: toolAuditLifecycle.onOutputTargetReady,
      onRunLevelFailureOutputTargetReady:
        toolAuditLifecycle.onRunLevelFailureOutputTargetReady
    });

    const lifecycleManager = new RunLifecycleManager({
      clientManager: options.clientManager,
      onCleanupDiagnostics(errors) {
        options.onProgressEvent?.({
          type: "run-warning",
          message: formatCopilotCleanupDiagnostics(errors)
        });
      }
    });

    return {
      orchestrator,
      lifecycleManager,
      flush: () => toolAuditLifecycle.flush()
    };
  }
}

export class DryRunRunDepsBuilder {
  readonly #options: RunDepsSharedOptions;

  constructor(options: RunDepsSharedOptions) {
    this.#options = options;
  }

  build(reviewConfig: ReviewConfig): RunDeps {
    const options = this.#options;
    const reviewSessionFactory = new DryRunReviewSessionFactory();
    const dryRunSharedOptions: RunDepsSharedOptions = {
      ...options,
      perFileStepsFactory:
        options.perFileStepsFactory ?? buildDefaultDryRunPerFileSteps
    };

    const orchestrator = buildOrchestrator({
      shared: dryRunSharedOptions,
      reviewConfig,
      reviewSessionFactory,
      onOutputTargetReady: undefined,
      onRunLevelFailureOutputTargetReady: undefined
    });

    return {
      orchestrator,
      lifecycleManager: new RunLifecycleManager(),
      flush: async () => {}
    };
  }
}

const buildDefaultDryRunPerFileSteps: ReviewPerFileStepsFactory = (input) =>
  buildDefaultPerFileSteps(input, { reviewSummaryLanguage: "en" });

interface BuildOrchestratorParams {
  shared: RunDepsSharedOptions;
  reviewConfig: ReviewConfig;
  reviewSessionFactory: Pick<ReviewSessionFactory, "createSession">;
  onOutputTargetReady: ((outputTarget: ToolAuditOutputTarget) => void) | undefined;
  onRunLevelFailureOutputTargetReady:
    | ((outputTarget: ToolAuditOutputTarget) => Promise<void>)
    | undefined;
}

function buildOrchestrator(params: BuildOrchestratorParams): ReviewOrchestrator {
  const {
    shared,
    reviewConfig,
    reviewSessionFactory,
    onOutputTargetReady,
    onRunLevelFailureOutputTargetReady
  } = params;

  const changesetOverviewRunner =
    shared.changesetOverviewRunner ??
    new ChangesetOverviewRunner({
      reviewSessionFactory,
      onChangesetOverviewLog(message) {
        shared.onProgressEvent?.({
          type: "review-session-log",
          stepId: CHANGESET_OVERVIEW_STEP_ID,
          message
        });
      }
    });
  const stepRunner =
    shared.stepRunner ??
    new StepRunner({
      reviewSessionFactory,
      onStepRetry(info) {
        shared.onProgressEvent?.({
          type: "review-session-log",
          stepId: info.stepId,
          message: formatStepRetryDiagnostic(info)
        });
      }
    });

  return new ReviewOrchestrator({
    changesetOverviewRunner,
    reviewFileFilter: shared.reviewFileFilter,
    sourceProvider: shared.sourceProvider,
    outputSink: shared.outputSink,
    successfulSnapshotOutputHealthAssessor:
      shared.successfulSnapshotOutputHealthAssessor,
    stepRunner,
    workingDirectory: shared.workingDirectory,
    timestampProvider: shared.timestampProvider,
    maxConcurrentFiles: reviewConfig.maxConcurrentFiles,
    perFileStepsFactory: shared.perFileStepsFactory,
    onProgressEvent: shared.onProgressEvent,
    onOutputTargetReady,
    onRunLevelFailureOutputTargetReady
  });
}

function formatStepRetryDiagnostic(info: {
  filePath: string;
  attempt: number;
  cause: string;
  model?: string;
}): string {
  const fields = [
    `file=${info.filePath}`,
    `attempt=${info.attempt + 1}`,
    info.model === undefined ? undefined : `model=${info.model}`,
    `cause=${JSON.stringify(info.cause)}`
  ].filter((field): field is string => field !== undefined);

  return `Step retry (${fields.join(", ")})`;
}

function formatCopilotCleanupDiagnostics(errors: readonly Error[]): string {
  const details = errors.map((error) => error.message).join("; ");
  return `Copilot client cleanup completed with ${errors.length} diagnostic error(s): ${details}`;
}

function createProductionToolAuditLifecycle(
  onWriteFailure: ((failure: ToolAuditWriteFailure) => void) | undefined
): ToolAuditLifecycle {
  const toolAudit = new ReviewRunToolAudit({
    onWriteFailure(failure) {
      onWriteFailure?.(failure);
    }
  });

  return {
    auditWriterProvider: () => toolAudit.sink,
    onOutputTargetReady: (outputTarget) => {
      toolAudit.bindOutputTarget(outputTarget);
    },
    onRunLevelFailureOutputTargetReady: (outputTarget) =>
      toolAudit.bindFailureOutputTarget(outputTarget),
    flush: () => toolAudit.flush()
  };
}
