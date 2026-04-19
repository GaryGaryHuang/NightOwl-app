import assert from "node:assert/strict";
import test from "node:test";

import type { FileReviewContext } from "../../src/core/file-review-context.ts";
import {
  ReviewOrchestrator,
  ReviewRunInterruptedError
} from "../../src/core/orchestrator.ts";
import { createRunContext } from "../../src/core/run-context.ts";
import type { StepDefinition } from "../../src/core/step-runner.ts";
import type { ReviewFileFilter } from "../../src/providers/review-file-filter.ts";
import type { ReviewOutputSink } from "../../src/providers/review-output-sink.ts";
import type { ReviewOutputBootstrapAndPublisher } from "../helpers/output-sink-double.ts";
import type { ReviewSourceProvider } from "../../src/providers/review-source-provider.ts";
import { SessionTurnAbortedError } from "../../src/services/session-executor.ts";
import { stubChangeMap } from "../helpers/change-map-stub.ts";
import { defineOutputSinkDouble } from "../helpers/output-sink-double.ts";

type StepRunInput = {
  step: StepDefinition;
  context: FileReviewContext;
  outputBaseDir: string;
  repoRoot: string;
  workingDirectory: string;
};

type StepRunnerDouble = {
  run(input: StepRunInput): Promise<{
    stepId: string;
    applyTo(context: FileReviewContext): void;
  }>;
};

type InterruptSignal = "SIGINT" | "SIGTERM" | undefined;

function createMockSourceProvider(files: string[]): ReviewSourceProvider {
  return {
    async resolveRepoRoot(startPath: string): Promise<string> {
      return startPath;
    },
    async getChangesetEntries(
      _repoRoot: string,
      _baseRef: string,
      _headRef: string
    ): Promise<string[]> {
      return files;
    },
    async getCurrentBranch(_repoRoot: string): Promise<string> {
      return "feature-branch";
    },
    async getChangedFiles(
      _repoRoot: string,
      _baseRef: string,
      _headRef: string
    ): Promise<string[]> {
      return files;
    },
    async getDiff(
      _repoRoot: string,
      _baseRef: string,
      _headRef: string,
      _filePath: string
    ): Promise<string> {
      return "--- a/file\n+++ b/file\n@@ -1 +1 @@\n-old\n+new\n";
    }
  };
}

function createPassthroughReviewFileFilter(): ReviewFileFilter {
  return {
    async filterReviewableFiles(_repoRoot: string, files: string[]): Promise<string[]> {
      return files;
    }
  };
}

type TrackingOutputSink = ReviewOutputBootstrapAndPublisher & {
  calls: string[];
};

function createTrackingOutputSink(): TrackingOutputSink {
  const calls: string[] = [];
  return {
    calls,
    async initializeRun(_outputTarget) {
      calls.push("initializeRun");
      return this;
    },
    async publishFileReview(_result) {
      calls.push("publishFileReview");
    },
    async publishSkippedFile(_record) {
      calls.push("publishSkippedFile");
    },
    async publishRunSummary(_result) {
      calls.push("publishRunSummary");
    },
    async publishReviewIndex(_result) {
      calls.push("publishReviewIndex");
    },
    async publishVerifierReport(_result) {
      calls.push("publishVerifierReport");
    },
    async publishRunManifest(_result) {
      calls.push("publishRunManifest");
    },
    async publishChangesetOverview(_result) {
      calls.push("publishChangesetOverview");
    }
  };
}

function createStepRunnerDouble(
  onRun?: (input: StepRunInput) => void | Promise<void>
): StepRunnerDouble {
  return {
    async run(input) {
      await onRun?.(input);

      return {
        stepId: input.step.stepId,
        applyTo(_ctx: FileReviewContext) {}
      };
    }
  };
}

const TEST_REQUEST = {
  baseRef: "main",
  headRef: "feature-branch",
  repoPath: ".",
  userContext: [],
  dryRun: false
};

const TEST_FILES = ["src/app.ts", "packages/app/index.ts"];

function createBaseOrchestrator(overrides: {
  sourceProvider?: ReviewSourceProvider;
  outputSink?: ReviewOutputSink;
  stepRunner?: StepRunnerDouble;
  changesetOverviewRunner?: { run: (...args: any[]) => Promise<any> };
  maxConcurrentFiles?: number;
}) {
  return new ReviewOrchestrator({
    workingDirectory: "/tmp/abort-test",
    timestampProvider: () => "03131430",
    sourceProvider:
      overrides.sourceProvider ?? createMockSourceProvider(TEST_FILES),
    reviewFileFilter: createPassthroughReviewFileFilter(),
    outputSink: overrides.outputSink ?? createTrackingOutputSink(),
    stepRunner: overrides.stepRunner ?? createStepRunnerDouble(),
    changesetOverviewRunner: overrides.changesetOverviewRunner ?? {
      async run() {
        return createRunContext({
          changesetOverview: stubChangeMap("## Changeset\n- test"),
          userContext: []
        });
      }
    },
    maxConcurrentFiles: overrides.maxConcurrentFiles ?? 1
  });
}

async function assertRunInterrupted(
  run: () => Promise<unknown>,
  expectedSignal?: InterruptSignal,
  message?: string
): Promise<void> {
  await assert.rejects(run, (error: unknown) => {
    assert.ok(
      error instanceof ReviewRunInterruptedError,
      message ?? "expected ReviewRunInterruptedError"
    );
    assert.equal(error.signal, expectedSignal, message);
    return true;
  });
}

function recordStep1Calls(step1Calls: string[]): StepRunnerDouble {
  return createStepRunnerDouble(({ step, context }) => {
    if (step.stepId === "step1-overview") {
      step1Calls.push(context.filePath);
    }
  });
}

function assertNoRunLevelArtifactsPublished(sink: TrackingOutputSink): void {
  for (const call of [
    "publishRunSummary",
    "publishReviewIndex",
    "publishVerifierReport",
    "publishRunManifest"
  ]) {
    assert.equal(
      sink.calls.includes(call),
      false,
      `${call} should not be called after abort`
    );
  }
}

test("ReviewOrchestrator throws ReviewRunInterruptedError when signal is already aborted before dispatch", async () => {
  const controller = new AbortController();
  controller.abort();
  const step1Calls: string[] = [];
  const orchestrator = createBaseOrchestrator({
    stepRunner: recordStep1Calls(step1Calls)
  });

  await assertRunInterrupted(
    () => orchestrator.run(TEST_REQUEST, { signal: controller.signal }),
    undefined,
    "pre-aborted signal should interrupt the run"
  );
  assert.deepEqual(step1Calls, []);
});

test("ReviewOrchestrator maps an aborted Step 0 review turn to ReviewRunInterruptedError", async () => {
  const controller = new AbortController();
  const step1Calls: string[] = [];
  const orchestrator = createBaseOrchestrator({
    changesetOverviewRunner: {
      async run() {
        controller.abort("SIGINT");
        throw new SessionTurnAbortedError();
      }
    },
    stepRunner: recordStep1Calls(step1Calls)
  });

  await assertRunInterrupted(
    () => orchestrator.run(TEST_REQUEST, { signal: controller.signal }),
    "SIGINT"
  );
  assert.deepEqual(step1Calls, []);
});

test("ReviewOrchestrator stops before per-file dispatch when signal aborts during post-Step0 planning", async () => {
  const controller = new AbortController();
  const sink = createTrackingOutputSink();
  const step1Calls: string[] = [];
  const orchestrator = createBaseOrchestrator({
    outputSink: defineOutputSinkDouble({
      ...sink,
      async initializeRun(outputTarget) {
        const publisher = await sink.initializeRun(outputTarget);
        controller.abort("SIGINT");
        return publisher;
      }
    }),
    stepRunner: recordStep1Calls(step1Calls)
  });

  await assertRunInterrupted(
    () => orchestrator.run(TEST_REQUEST, { signal: controller.signal }),
    "SIGINT"
  );
  assert.deepEqual(step1Calls, []);
  assertNoRunLevelArtifactsPublished(sink);
});

test("ReviewOrchestrator stops before Step 1 when signal aborts during bootstrap snapshot publication", async () => {
  const controller = new AbortController();
  const sink = createTrackingOutputSink();
  const step1Calls: string[] = [];
  let bootstrapAbortFired = false;
  const orchestrator = createBaseOrchestrator({
    outputSink: defineOutputSinkDouble({
      ...sink,
      async publishFileReview(result) {
        await sink.publishFileReview(result);
        if (!bootstrapAbortFired) {
          bootstrapAbortFired = true;
          controller.abort("SIGINT");
        }
      }
    }),
    stepRunner: recordStep1Calls(step1Calls)
  });

  await assertRunInterrupted(
    () => orchestrator.run(TEST_REQUEST, { signal: controller.signal }),
    "SIGINT"
  );
  assert.deepEqual(step1Calls, []);
  assertNoRunLevelArtifactsPublished(sink);
});

test("ReviewOrchestrator stops new file dispatch when signal aborts during fan-out", async () => {
  const threeFiles = ["src/app.ts", "packages/app/index.ts", "extra/helper.ts"];
  const controller = new AbortController();
  const step1Calls: string[] = [];
  let abortFired = false;
  const orchestrator = createBaseOrchestrator({
    sourceProvider: createMockSourceProvider(threeFiles),
    maxConcurrentFiles: 2,
    stepRunner: createStepRunnerDouble(({ step, context }) => {
      if (step.stepId === "step1-overview") {
        step1Calls.push(context.filePath);

        if (!abortFired) {
          abortFired = true;
          controller.abort();
        }
      }
    })
  });

  await assertRunInterrupted(
    () => orchestrator.run(TEST_REQUEST, { signal: controller.signal }),
    undefined
  );
  assert.equal(
    step1Calls.includes("extra/helper.ts"),
    false,
    "third file should not enter Step 1 after abort"
  );
});

test("ReviewOrchestrator worker stops at the next safe boundary and does not start the following step", async () => {
  const controller = new AbortController();
  const stepsExecuted: string[] = [];
  const orchestrator = createBaseOrchestrator({
    stepRunner: createStepRunnerDouble(({ step }) => {
      stepsExecuted.push(step.stepId);
      if (step.stepId === "step1-overview") {
        controller.abort();
      }
    })
  });

  await assertRunInterrupted(
    () => orchestrator.run(TEST_REQUEST, { signal: controller.signal }),
    undefined
  );
  assert.equal(stepsExecuted.includes("step1-overview"), true);
  assert.equal(stepsExecuted.includes("step2-dependencies-boundaries"), false);
});

test("ReviewOrchestrator does not publish a new per-file snapshot after abort signal", async () => {
  const controller = new AbortController();
  const sink = createTrackingOutputSink();
  const fileReviewCallsAfterAbort: string[] = [];
  let abortFired = false;
  const orchestrator = createBaseOrchestrator({
    outputSink: defineOutputSinkDouble({
      ...sink,
      async publishFileReview(result) {
        if (abortFired) {
          fileReviewCallsAfterAbort.push(result.noteFilePath);
        }
        await sink.publishFileReview(result);
      }
    }),
    stepRunner: createStepRunnerDouble(({ step }) => {
      if (step.stepId === "step1-overview" && !abortFired) {
        abortFired = true;
        controller.abort();
      }
    })
  });

  await assertRunInterrupted(
    () => orchestrator.run(TEST_REQUEST, { signal: controller.signal }),
    undefined
  );
  assert.deepEqual(fileReviewCallsAfterAbort, []);
});

test("ReviewOrchestrator does not publish run-level artifacts after external abort", async () => {
  const controller = new AbortController();
  const sink = createTrackingOutputSink();
  const orchestrator = createBaseOrchestrator({
    outputSink: sink,
    stepRunner: createStepRunnerDouble(({ step }) => {
      if (step.stepId === "step1-overview") {
        controller.abort();
      }
    })
  });

  await assertRunInterrupted(
    () => orchestrator.run(TEST_REQUEST, { signal: controller.signal }),
    undefined
  );
  assertNoRunLevelArtifactsPublished(sink);
});

test("ReviewOrchestrator maps recognized abort reasons onto interrupted run errors", async () => {
  const cases: Array<{
    label: string;
    abort: (controller: AbortController) => void;
    expectedSignal?: InterruptSignal;
  }> = [
    {
      label: "SIGINT",
      abort(controller) {
        controller.abort("SIGINT");
      },
      expectedSignal: "SIGINT"
    },
    {
      label: "SIGTERM",
      abort(controller) {
        controller.abort("SIGTERM");
      },
      expectedSignal: "SIGTERM"
    },
    {
      label: "default AbortController reason",
      abort(controller) {
        controller.abort();
      },
      expectedSignal: undefined
    },
    {
      label: "unrecognized string reason",
      abort(controller) {
        controller.abort("SIGHUP");
      },
      expectedSignal: undefined
    },
    {
      label: "non-string reason",
      abort(controller) {
        controller.abort(42);
      },
      expectedSignal: undefined
    }
  ];

  for (const testCase of cases) {
    const controller = new AbortController();
    const orchestrator = createBaseOrchestrator({
      stepRunner: createStepRunnerDouble(({ step }) => {
        if (step.stepId === "step1-overview") {
          testCase.abort(controller);
        }
      })
    });

    await assertRunInterrupted(
      () => orchestrator.run(TEST_REQUEST, { signal: controller.signal }),
      testCase.expectedSignal,
      testCase.label
    );
  }
});
