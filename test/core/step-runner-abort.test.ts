import assert from "node:assert/strict";
import test from "node:test";

import { StepRunner } from "../../src/core/step-runner.ts";
import {
  SessionExecutor,
  SessionTurnAbortedError
} from "../../src/services/session-executor.ts";
import {
  createSectionTestStep,
  createStructuredTestStep,
  createStepRunnerContext
} from "../helpers/step-runner-contract-fixture.ts";

async function assertRejectsWithAbortBeforeTimeout(
  promise: Promise<unknown>
): Promise<void> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(
      () => reject(new Error("timed out waiting for session creation abort")),
      100
    );
  });

  try {
    await assert.rejects(
      () => Promise.race([promise, timeoutPromise]),
      (error: unknown) => error instanceof SessionTurnAbortedError
    );
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

test("StepRunner does not consume retry budget or run resolve when a section-step review turn is aborted", async () => {
  const controller = new AbortController();
  const context = createStepRunnerContext();
  let reviewAttempts = 0;
  let abortCalls = 0;
  let resolveCalls = 0;
  let retryCallCount = 0;
  let resolveSend:
    | ((value: { data?: { content?: string } } | undefined) => void)
    | undefined;
  const runner = new StepRunner({
    reviewSessionFactory: {
      async createSession() {
        reviewAttempts += 1;

        return new SessionExecutor({
          async sendAndWait() {
            queueMicrotask(() => controller.abort("SIGINT"));
            return await new Promise<{ data?: { content?: string } } | undefined>((resolve) => {
              resolveSend = resolve;
            });
          },
          async abort() {
            abortCalls += 1;
            resolveSend?.(undefined);
          },
          async disconnect() {}
        });
      }
    },
    onStepRetry() {
      retryCallCount += 1;
    }
  });

  await assert.rejects(
    () =>
      runner.run({
        step: createSectionTestStep({
          resolve: async () => {
            resolveCalls += 1;
            return () => {};
          }
        }),
        context,
        repoRoot: "/workspace/repo",
        signal: controller.signal
      }),
    (error: unknown) => error instanceof SessionTurnAbortedError
  );
  assert.equal(reviewAttempts, 1);
  assert.equal(abortCalls, 1);
  assert.equal(resolveCalls, 0);
  assert.equal(retryCallCount, 0);
});

test("StepRunner does not consume retry budget or run deterministic validation when a structured-step review turn is aborted", async () => {
  const controller = new AbortController();
  const context = createStepRunnerContext();
  let reviewAttempts = 0;
  let abortCalls = 0;
  let validateCalls = 0;
  let resolveSend:
    | ((value: { data?: { content?: string } } | undefined) => void)
    | undefined;
  const runner = new StepRunner({
    reviewSessionFactory: {
      async createSession() {
        reviewAttempts += 1;

        return new SessionExecutor({
          async sendAndWait() {
            queueMicrotask(() => controller.abort("SIGINT"));
            return await new Promise<{ data?: { content?: string } } | undefined>((resolve) => {
              resolveSend = resolve;
            });
          },
          async abort() {
            abortCalls += 1;
            resolveSend?.(undefined);
          },
          async disconnect() {}
        });
      }
    }
  });

  await assert.rejects(
    () =>
      runner.run({
        step: createStructuredTestStep({
          resolve: async () => {
            validateCalls += 1;
            return () => {};
          }
        }),
        context,
        repoRoot: "/workspace/repo",
        signal: controller.signal
      }),
    (error: unknown) => error instanceof SessionTurnAbortedError
  );
  assert.equal(reviewAttempts, 1);
  assert.equal(abortCalls, 1);
  assert.equal(validateCalls, 0);
});

test("StepRunner aborts while creating a review session", async () => {
  const controller = new AbortController();
  const context = createStepRunnerContext();
  let reviewAttempts = 0;
  let receivedSignal = false;
  const runner = new StepRunner({
    reviewSessionFactory: {
      async createSession(_profile, options) {
        reviewAttempts += 1;
        receivedSignal = options?.signal === controller.signal;

        return await new Promise((_, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () => reject(new SessionTurnAbortedError()),
            { once: true }
          );
        });
      }
    },
    onStepRetry() {
      assert.fail("aborted session creation must not consume retry budget");
    }
  });

  const pending = runner.run({
    step: createSectionTestStep({}),
    context,
    repoRoot: "/workspace/repo",
    signal: controller.signal
  });
  controller.abort("SIGINT");

  await assertRejectsWithAbortBeforeTimeout(pending);
  assert.equal(reviewAttempts, 1);
  assert.equal(receivedSignal, true);
});
