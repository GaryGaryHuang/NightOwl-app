import type { RunProgressEventHandler } from "../core/run-progress.ts";
import {
  ChangesetOverviewRunner
} from "../core/changeset-overview-runner.ts";
import {
  ReviewOrchestrator,
  type ReviewPerFileStepsFactory
} from "../core/orchestrator.ts";
import { JudgeService } from "../core/judge.ts";
import { StepRunner } from "../core/step-runner.ts";
import { StructuredOutputValidator } from "../core/structured-output-validator.ts";
import type { ReviewConfig } from "../providers/config/review-config-provider.ts";
import type { ReviewFileFilter } from "../providers/review-file-filter.ts";
import type { ReviewOutputSink } from "../providers/review-output-sink.ts";
import type { OutputWriteHealthAssessor } from "../providers/review-output-health-assessor.ts";
import type { ReviewSourceProvider } from "../providers/review-source-provider.ts";
import { JudgeSessionFactory } from "../services/judge-session-factory.ts";
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
import type { WebFetchHostnameClassifier } from "../services/tool-policy/web-fetch-hostname-classifier.ts";
import {
  DryRunReviewSessionFactory
} from "../services/dry-run-review-session-factory.ts";
import {
  DryRunJudgeSessionFactory
} from "../services/dry-run-judge-session-factory.ts";
import { RunLifecycleManager } from "./run-lifecycle-manager.ts";

export interface RunDeps {
  orchestrator: ReviewOrchestrator;
  lifecycleManager: RunLifecycleManager;
  flush(): Promise<void>;
}

export interface RunDepsBuilder {
  build(reviewConfig: ReviewConfig): RunDeps;
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
  knowledgeSvc?: Pick<KnowledgeSvc, "getMcpServers">;
  context7ApiKey?: string;
  webFetchHostnameClassifier?: WebFetchHostnameClassifier;
  webFetchHostnameClassificationTimeoutMs?: number;
  gracefulShutdownTimeoutMs: number;
  onToolAuditWriteFailure?: (failure: ToolAuditWriteFailure) => void;
}

export interface DryRunDepsBuilderOptions extends RunDepsSharedOptions {
  gracefulShutdownTimeoutMs: number;
}

interface ToolAuditLifecycle {
  auditWriterProvider?: () => ToolAuditSink | undefined;
  onOutputTargetReady?: (outputTarget: ToolAuditOutputTarget) => void;
  flush(): Promise<void>;
}

const noopToolAuditLifecycle: ToolAuditLifecycle = {
  flush: async () => {}
};

export class ProductionRunDepsBuilder implements RunDepsBuilder {
  readonly #options: ProductionRunDepsBuilderOptions;

  constructor(options: ProductionRunDepsBuilderOptions) {
    this.#options = options;
  }

  build(reviewConfig: ReviewConfig): RunDeps {
    const options = this.#options;
    const toolAuditLifecycle = createProductionToolAuditLifecycle(
      options.onToolAuditWriteFailure
    );
    const judgeSessionFactory = new JudgeSessionFactory({
      clientManager: options.clientManager
    });
    const judgeService = new JudgeService({ judgeSessionFactory });

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
    const reviewSessionFactory = new ReviewSessionFactory({
      clientManager: options.clientManager,
      knowledgeSvc,
      toolPolicyGuard,
      auditWriterProvider: toolAuditLifecycle.auditWriterProvider
    });

    const orchestrator = buildOrchestrator({
      shared: options,
      reviewConfig,
      reviewSessionFactory,
      judgeService,
      onOutputTargetReady: toolAuditLifecycle.onOutputTargetReady
    });

    const lifecycleManager = new RunLifecycleManager({
      clientManager: options.clientManager,
      gracefulShutdownTimeoutMs: options.gracefulShutdownTimeoutMs
    });

    return {
      orchestrator,
      lifecycleManager,
      flush: () => toolAuditLifecycle.flush()
    };
  }
}

export class DryRunRunDepsBuilder implements RunDepsBuilder {
  readonly #options: DryRunDepsBuilderOptions;

  constructor(options: DryRunDepsBuilderOptions) {
    this.#options = options;
  }

  build(reviewConfig: ReviewConfig): RunDeps {
    const options = this.#options;
    const judgeSessionFactory = new DryRunJudgeSessionFactory();
    const judgeService = new JudgeService({ judgeSessionFactory });
    const reviewSessionFactory = new DryRunReviewSessionFactory();

    const orchestrator = buildOrchestrator({
      shared: options,
      reviewConfig,
      reviewSessionFactory,
      judgeService,
      onOutputTargetReady: undefined
    });

    const lifecycleManager = new RunLifecycleManager({
      gracefulShutdownTimeoutMs: options.gracefulShutdownTimeoutMs
    });

    return {
      orchestrator,
      lifecycleManager,
      flush: noopToolAuditLifecycle.flush
    };
  }
}

interface BuildOrchestratorParams {
  shared: RunDepsSharedOptions;
  reviewConfig: ReviewConfig;
  reviewSessionFactory: Pick<ReviewSessionFactory, "createSession">;
  judgeService: JudgeService;
  onOutputTargetReady: ((outputTarget: ToolAuditOutputTarget) => void) | undefined;
}

function buildOrchestrator(params: BuildOrchestratorParams): ReviewOrchestrator {
  const { shared, reviewConfig, reviewSessionFactory, judgeService, onOutputTargetReady } = params;

  const changesetOverviewRunner =
    shared.changesetOverviewRunner ??
    new ChangesetOverviewRunner({ reviewSessionFactory });
  const stepRunner =
    shared.stepRunner ??
    new StepRunner({
      reviewSessionFactory,
      judgeService,
      structuredOutputValidator: new StructuredOutputValidator()
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
    onOutputTargetReady
  });
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
    flush: () => toolAudit.flush()
  };
}
