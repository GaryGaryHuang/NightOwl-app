import assert from "node:assert/strict";
import test from "node:test";

import {
  ReviewOrchestrator,
  ReviewRunInterruptedError
} from "../../src/core/orchestrator.ts";
import { createRunContext } from "../../src/core/run-context.ts";
import { SessionTurnAbortedError } from "../../src/services/session-executor.ts";
import type { ReviewOutputSink } from "../../src/providers/review-output-sink.ts";
import type { ReviewSourceProvider } from "../../src/providers/review-source-provider.ts";
import type { FileReviewContext } from "../../src/core/file-review-context.ts";
import type { StepDefinition } from "../../src/core/step-runner.ts";

// ─── helpers ──────────────────────────────────────────────────────────────────

function createMockSourceProvider(files: string[]): ReviewSourceProvider {
  return {
    resolveRepoRoot(startPath: string): string {
      return startPath;
    },
    getChangesetEntries(
      _repoRoot: string,
      _baseRef: string,
      _headRef: string
    ): string[] {
      return files;
    },
    getCurrentBranch(_repoRoot: string): string {
      return "feature-branch";
    },
    getChangedFiles(
      _repoRoot: string,
      _baseRef: string,
      _headRef: string
    ): string[] {
      return files;
    },
    filterIgnoredFiles(_repoRoot: string, changedFiles: string[]): string[] {
      return changedFiles;
    },
    getDiff(
      _repoRoot: string,
      _baseRef: string,
      _headRef: string,
      _filePath: string
    ): string {
      return "--- a/file\n+++ b/file\n@@ -1 +1 @@\n-old\n+new\n";
    }
  };
}

interface TrackingOutputSink extends ReviewOutputSink {
  calls: string[];
}

function createTrackingOutputSink(): TrackingOutputSink {
  const calls: string[] = [];
  return {
    calls,
    initializeRun(_outputTarget) {
      calls.push("initializeRun");
    },
    publishFileReview(_result) {
      calls.push("publishFileReview");
    },
    publishSkippedFile(_record) {
      calls.push("publishSkippedFile");
    },
    publishRunSummary(_result) {
      calls.push("publishRunSummary");
    },
    publishReviewIndex(_result) {
      calls.push("publishReviewIndex");
    },
    publishRunManifest(_result) {
      calls.push("publishRunManifest");
    },
    publishChangesetOverview(_result) {
      calls.push("publishChangesetOverview");
    }
  };
}

function createNoOpStepRunner() {
  return {
    async run({
      step
    }: {
      step: StepDefinition;
      context: FileReviewContext;
      outputBaseDir: string;
      repoRoot: string;
      workingDirectory: string;
    }) {
      return {
        stepId: step.stepId,
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
  stepRunner?: { run: (...args: any[]) => Promise<any> };
  changesetOverviewRunner?: { run: (...args: any[]) => Promise<any> };
  maxConcurrentFiles?: number;
}) {
  return new ReviewOrchestrator({
    workingDirectory: "/tmp/abort-test",
    timestampProvider: () => "03131430",
    sourceProvider:
      overrides.sourceProvider ?? createMockSourceProvider(TEST_FILES),
    outputSink: overrides.outputSink ?? createTrackingOutputSink(),
    stepRunner: overrides.stepRunner ?? createNoOpStepRunner(),
    changesetOverviewRunner: overrides.changesetOverviewRunner ?? {
      async run() {
        return createRunContext({
          changesetOverview: "## Changeset\n- test",
          userContext: []
        });
      }
    },
    maxConcurrentFiles: overrides.maxConcurrentFiles ?? 1
  });
}

// ─── ReviewRunInterruptedError basic tests ──────────────────────────────────

test("ReviewRunInterruptedError is an instance of Error", () => {
  const err = new ReviewRunInterruptedError();
  assert.ok(err instanceof Error);
  assert.ok(err instanceof ReviewRunInterruptedError);
  assert.equal(err.message, "Run interrupted by external signal.");
});

test("ReviewRunInterruptedError name property identifies the error type", () => {
  const err = new ReviewRunInterruptedError();
  assert.equal(err.name, "ReviewRunInterruptedError");
});

test("ReviewRunInterruptedError instanceof distinguishes it from a generic Error", () => {
  const interrupted = new ReviewRunInterruptedError();
  const generic = new Error("generic");
  assert.ok(interrupted instanceof ReviewRunInterruptedError);
  assert.ok(!(generic instanceof ReviewRunInterruptedError));
});

// ─── Orchestrator AbortSignal tests ─────────────────────────────────────────

// Signal is checked before the fan-out loop; no file should enter Step 1.
test("ReviewOrchestrator throws ReviewRunInterruptedError when signal is already aborted before dispatch", async () => {
  const controller = new AbortController();
  controller.abort();

  const step1Calls: string[] = [];
  const orchestrator = createBaseOrchestrator({
    stepRunner: {
      async run({ step, context }: { step: { stepId: string }; context: { filePath: string } }) {
        if (step.stepId === "step1-overview") {
          step1Calls.push(context.filePath);
        }
        return { stepId: step.stepId, applyTo(_ctx: FileReviewContext) {} };
      }
    }
  });

  await assert.rejects(
    () => orchestrator.run(TEST_REQUEST, { signal: controller.signal }),
    (err: unknown) => err instanceof ReviewRunInterruptedError
  );
  assert.deepEqual(step1Calls, [], "No file should enter Step 1 when signal is pre-aborted");
});

// The signal fires *inside* changesetOverviewRunner.run() before it returns,
// so the orchestrator sees the abort before it dispatches any per-file work.
test("ReviewOrchestrator throws ReviewRunInterruptedError when signal is aborted during Step 0", async () => {
  const controller = new AbortController();
  const step1Calls: string[] = [];

  const orchestrator = createBaseOrchestrator({
    changesetOverviewRunner: {
      async run() {
        // Signal fires "during" Step 0 — before Step 0 returns
        controller.abort();
        return createRunContext({
          changesetOverview: "## Changeset\n- test",
          userContext: []
        });
      }
    },
    stepRunner: {
      async run({ step, context }: { step: { stepId: string }; context: { filePath: string } }) {
        if (step.stepId === "step1-overview") {
          step1Calls.push(context.filePath);
        }
        return { stepId: step.stepId, applyTo(_ctx: FileReviewContext) {} };
      }
    }
  });

  await assert.rejects(
    () => orchestrator.run(TEST_REQUEST, { signal: controller.signal }),
    (err: unknown) => err instanceof ReviewRunInterruptedError
  );
  assert.deepEqual(step1Calls, [], "No file should enter Step 1 when signal is aborted during Step 0");
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
    stepRunner: {
      async run({ step, context }: { step: { stepId: string }; context: { filePath: string } }) {
        if (step.stepId === "step1-overview") {
          step1Calls.push(context.filePath);
        }
        return { stepId: step.stepId, applyTo(_ctx: FileReviewContext) {} };
      }
    }
  });

  await assert.rejects(
    () => orchestrator.run(TEST_REQUEST, { signal: controller.signal }),
    (err: unknown) => err instanceof ReviewRunInterruptedError && err.signal === "SIGINT"
  );
  assert.deepEqual(step1Calls, [], "No file should enter Step 1 after an aborted Step 0 turn");
});

test("ReviewOrchestrator throws ReviewRunInterruptedError when signal aborts during post-Step0 planning", async () => {
  const controller = new AbortController();
  const sink = createTrackingOutputSink();
  const step1Calls: string[] = [];

  const orchestrator = createBaseOrchestrator({
    outputSink: {
      ...sink,
      initializeRun(outputTarget) {
        sink.initializeRun(outputTarget);
        controller.abort("SIGINT");
      }
    },
    stepRunner: {
      async run({ step, context }: { step: { stepId: string }; context: { filePath: string } }) {
        if (step.stepId === "step1-overview") {
          step1Calls.push(context.filePath);
        }
        return { stepId: step.stepId, applyTo(_ctx: FileReviewContext) {} };
      }
    }
  });

  await assert.rejects(
    () => orchestrator.run(TEST_REQUEST, { signal: controller.signal }),
    (err: unknown) => err instanceof ReviewRunInterruptedError && err.signal === "SIGINT"
  );
  assert.deepEqual(step1Calls, [], "No file should enter Step 1 when signal aborts during planning");
  assert.ok(
    !sink.calls.includes("publishRunSummary"),
    "publishRunSummary should not be called after a planning-phase abort"
  );
  assert.ok(
    !sink.calls.includes("publishReviewIndex"),
    "publishReviewIndex should not be called after a planning-phase abort"
  );
});

test("ReviewOrchestrator throws ReviewRunInterruptedError when signal aborts during bootstrap snapshot publication", async () => {
  const controller = new AbortController();
  const sink = createTrackingOutputSink();
  const step1Calls: string[] = [];
  let bootstrapAbortFired = false;

  const orchestrator = createBaseOrchestrator({
    outputSink: {
      ...sink,
      publishFileReview(result) {
        sink.publishFileReview(result);
        if (!bootstrapAbortFired) {
          bootstrapAbortFired = true;
          controller.abort("SIGINT");
        }
      }
    },
    stepRunner: {
      async run({ step, context }: { step: { stepId: string }; context: { filePath: string } }) {
        if (step.stepId === "step1-overview") {
          step1Calls.push(context.filePath);
        }
        return { stepId: step.stepId, applyTo(_ctx: FileReviewContext) {} };
      }
    }
  });

  await assert.rejects(
    () => orchestrator.run(TEST_REQUEST, { signal: controller.signal }),
    (err: unknown) => err instanceof ReviewRunInterruptedError && err.signal === "SIGINT"
  );
  assert.deepEqual(
    step1Calls,
    [],
    "No file should enter Step 1 when signal aborts during bootstrap publication"
  );
  assert.ok(
    !sink.calls.includes("publishRunSummary"),
    "publishRunSummary should not be called after a bootstrap-phase abort"
  );
  assert.ok(
    !sink.calls.includes("publishReviewIndex"),
    "publishReviewIndex should not be called after a bootstrap-phase abort"
  );
});

// Signal fires after the first file's step 1 starts; the orchestrator must
// not queue further files once the signal is set.
test("ReviewOrchestrator stops new file dispatch when signal aborts during fan-out", async () => {
  const threeFiles = ["src/app.ts", "packages/app/index.ts", "extra/helper.ts"];
  const controller = new AbortController();
  const step1Calls: string[] = [];
  let abortFired = false;

  const orchestrator = createBaseOrchestrator({
    sourceProvider: createMockSourceProvider(threeFiles),
    maxConcurrentFiles: 2,
    stepRunner: {
      async run({ step, context }: { step: { stepId: string }; context: { filePath: string } }) {
        if (step.stepId === "step1-overview") {
          step1Calls.push(context.filePath);
          // abort on first Step 1 call — before third file can be dispatched
          if (!abortFired) {
            abortFired = true;
            controller.abort();
          }
        }
        return { stepId: step.stepId, applyTo(_ctx: FileReviewContext) {} };
      }
    }
  });

  await assert.rejects(
    () => orchestrator.run(TEST_REQUEST, { signal: controller.signal }),
    (err: unknown) => err instanceof ReviewRunInterruptedError
  );
  assert.ok(
    !step1Calls.includes("extra/helper.ts"),
    "Third file should not enter Step 1 after abort"
  );
});

test("ReviewOrchestrator worker stops at next safe boundary and does not start the following step", async () => {
  const controller = new AbortController();
  const stepsExecuted: string[] = [];

  const orchestrator = createBaseOrchestrator({
    stepRunner: {
      async run({ step }: { step: { stepId: string } }) {
        stepsExecuted.push(step.stepId);
        if (step.stepId === "step1-overview") {
          // Abort during step1 — before step2 guard runs
          controller.abort();
        }
        return { stepId: step.stepId, applyTo(_ctx: FileReviewContext) {} };
      }
    }
  });

  await assert.rejects(
    () =>
      orchestrator.run(
        { ...TEST_REQUEST, repoPath: "." },
        { signal: controller.signal }
      ),
    (err: unknown) => err instanceof ReviewRunInterruptedError
  );
  assert.ok(
    stepsExecuted.includes("step1-overview"),
    "Step 1 should have started before abort"
  );
  assert.ok(
    !stepsExecuted.includes("step2-dependencies-boundaries"),
    "Step 2 should not start after abort"
  );
});

test("ReviewOrchestrator worker does not publish a new per-file snapshot after abort signal", async () => {
  const controller = new AbortController();
  const sink = createTrackingOutputSink();
  const fileReviewCallsAfterAbort: string[] = [];
  let abortFired = false;

  const orchestrator = createBaseOrchestrator({
    outputSink: {
      ...sink,
      publishFileReview(result) {
        if (abortFired) {
          fileReviewCallsAfterAbort.push(result.noteFilePath);
        }
        sink.publishFileReview(result);
      }
    },
    stepRunner: {
      async run({ step }: { step: { stepId: string } }) {
        if (step.stepId === "step1-overview" && !abortFired) {
          abortFired = true;
          controller.abort();
        }
        return { stepId: step.stepId, applyTo(_ctx: FileReviewContext) {} };
      }
    }
  });

  await assert.rejects(
    () => orchestrator.run(TEST_REQUEST, { signal: controller.signal }),
    (err: unknown) => err instanceof ReviewRunInterruptedError
  );
  assert.deepEqual(
    fileReviewCallsAfterAbort,
    [],
    "publishFileReview should not be called with a new per-file snapshot after abort"
  );
});

test("ReviewOrchestrator does not call publishRunSummary or publishReviewIndex after external abort", async () => {
  const controller = new AbortController();
  const sink = createTrackingOutputSink();

  const orchestrator = createBaseOrchestrator({
    outputSink: sink,
    stepRunner: {
      async run({ step }: { step: { stepId: string } }) {
        if (step.stepId === "step1-overview") {
          controller.abort();
        }
        return { stepId: step.stepId, applyTo(_ctx: FileReviewContext) {} };
      }
    }
  });

  await assert.rejects(
    () => orchestrator.run(TEST_REQUEST, { signal: controller.signal }),
    (err: unknown) => err instanceof ReviewRunInterruptedError
  );
  assert.ok(
    !sink.calls.includes("publishRunSummary"),
    "publishRunSummary should not be called after abort"
  );
  assert.ok(
    !sink.calls.includes("publishReviewIndex"),
    "publishReviewIndex should not be called after abort"
  );
});

test("ReviewOrchestrator calls publishRunSummary and publishReviewIndex on a normal run without abort", async () => {
  const sink = createTrackingOutputSink();

  const orchestrator = createBaseOrchestrator({
    outputSink: sink,
    stepRunner: createNoOpStepRunner()
  });

  await orchestrator.run(TEST_REQUEST);
  assert.ok(
    sink.calls.includes("publishRunSummary"),
    "publishRunSummary should be called on normal completion"
  );
  assert.ok(
    sink.calls.includes("publishReviewIndex"),
    "publishReviewIndex should be called on normal completion"
  );
});

test("ReviewOrchestrator run without signal option proceeds normally", async () => {
  const sink = createTrackingOutputSink();
  const orchestrator = createBaseOrchestrator({ outputSink: sink });

  const result = await orchestrator.run(TEST_REQUEST);
  assert.equal(result.plannedFileCount, TEST_FILES.length);
  assert.equal(result.successfulFileCount, TEST_FILES.length);
  assert.equal(result.skippedFileCount, 0);
});

// ─── ReviewRunInterruptedError signal property tests ────────────────────────

test("ReviewRunInterruptedError has signal === 'SIGINT' when constructed with 'SIGINT'", () => {
  const err = new ReviewRunInterruptedError("SIGINT");
  assert.equal(err.signal, "SIGINT");
});

test("ReviewRunInterruptedError has signal === 'SIGTERM' when constructed with 'SIGTERM'", () => {
  const err = new ReviewRunInterruptedError("SIGTERM");
  assert.equal(err.signal, "SIGTERM");
});

test("ReviewRunInterruptedError has signal === undefined when constructed without signal", () => {
  const err = new ReviewRunInterruptedError();
  assert.equal(err.signal, undefined);
});

test("ReviewRunInterruptedError is instanceof ReviewRunInterruptedError and not instanceof a generic Error subclass", () => {
  const err = new ReviewRunInterruptedError();
  assert.ok(err instanceof ReviewRunInterruptedError);
  assert.ok(err instanceof Error);
  const generic = new Error("generic");
  assert.ok(!(generic instanceof ReviewRunInterruptedError));
});

// ─── Orchestrator signal reason extraction tests ────────────────────────────

test("ReviewOrchestrator abort with reason 'SIGINT' produces ReviewRunInterruptedError with signal === 'SIGINT'", async () => {
  const controller = new AbortController();

  const orchestrator = createBaseOrchestrator({
    stepRunner: {
      async run({ step }: { step: { stepId: string } }) {
        if (step.stepId === "step1-overview") {
          controller.abort("SIGINT");
        }
        return { stepId: step.stepId, applyTo(_ctx: FileReviewContext) {} };
      }
    }
  });

  await assert.rejects(
    () => orchestrator.run(TEST_REQUEST, { signal: controller.signal }),
    (err: unknown) => err instanceof ReviewRunInterruptedError && err.signal === "SIGINT"
  );
});

test("ReviewOrchestrator abort with reason 'SIGTERM' produces ReviewRunInterruptedError with signal === 'SIGTERM'", async () => {
  const controller = new AbortController();

  const orchestrator = createBaseOrchestrator({
    stepRunner: {
      async run({ step }: { step: { stepId: string } }) {
        if (step.stepId === "step1-overview") {
          controller.abort("SIGTERM");
        }
        return { stepId: step.stepId, applyTo(_ctx: FileReviewContext) {} };
      }
    }
  });

  await assert.rejects(
    () => orchestrator.run(TEST_REQUEST, { signal: controller.signal }),
    (err: unknown) => err instanceof ReviewRunInterruptedError && err.signal === "SIGTERM"
  );
});

test("ReviewOrchestrator abort without reason produces ReviewRunInterruptedError with signal === undefined", async () => {
  const controller = new AbortController();

  const orchestrator = createBaseOrchestrator({
    stepRunner: {
      async run({ step }: { step: { stepId: string } }) {
        if (step.stepId === "step1-overview") {
          controller.abort();
        }
        return { stepId: step.stepId, applyTo(_ctx: FileReviewContext) {} };
      }
    }
  });

  await assert.rejects(
    () => orchestrator.run(TEST_REQUEST, { signal: controller.signal }),
    (err: unknown) => err instanceof ReviewRunInterruptedError && err.signal === undefined
  );
});

test("ReviewOrchestrator abort with unrecognized string reason produces ReviewRunInterruptedError with signal === undefined", async () => {
  const controller = new AbortController();

  const orchestrator = createBaseOrchestrator({
    stepRunner: {
      async run({ step }: { step: { stepId: string } }) {
        if (step.stepId === "step1-overview") {
          controller.abort("SIGHUP");
        }
        return { stepId: step.stepId, applyTo(_ctx: FileReviewContext) {} };
      }
    }
  });

  await assert.rejects(
    () => orchestrator.run(TEST_REQUEST, { signal: controller.signal }),
    (err: unknown) => err instanceof ReviewRunInterruptedError && err.signal === undefined
  );
});

test("ReviewOrchestrator abort with non-string reason produces ReviewRunInterruptedError with signal === undefined", async () => {
  const controller = new AbortController();

  const orchestrator = createBaseOrchestrator({
    stepRunner: {
      async run({ step }: { step: { stepId: string } }) {
        if (step.stepId === "step1-overview") {
          controller.abort(42);
        }
        return { stepId: step.stepId, applyTo(_ctx: FileReviewContext) {} };
      }
    }
  });

  await assert.rejects(
    () => orchestrator.run(TEST_REQUEST, { signal: controller.signal }),
    (err: unknown) => err instanceof ReviewRunInterruptedError && err.signal === undefined
  );
});
