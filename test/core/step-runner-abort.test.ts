import assert from "node:assert/strict";
import test from "node:test";

import { StepRunner } from "../../src/core/step-runner.ts";
import type { FindingsPayload } from "../../src/core/file-review-context.ts";
import {
  SessionExecutor,
  SessionTurnAbortedError
} from "../../src/services/session-executor.ts";
import {
  createSectionTestStep,
  createStructuredTestStep,
  createStepRunnerContext,
  DEFAULT_JUDGE_RESOLVE
} from "../helpers/step-runner-contract-fixture.ts";

test("StepRunner does not consume retry budget or start judge when a section-step review turn is aborted", async () => {
  const controller = new AbortController();
  const context = createStepRunnerContext();
  let reviewAttempts = 0;
  let abortCalls = 0;
  let judgeCalls = 0;
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
    judgeService: {
      async evaluate() {
        judgeCalls += 1;
        return { passed: true };
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
          resolve: DEFAULT_JUDGE_RESOLVE
        }),
        context,
        outputBaseDir: "/workspace/output",
        repoRoot: "/workspace/repo",
        signal: controller.signal
      }),
    (error: unknown) => error instanceof SessionTurnAbortedError
  );
  assert.equal(reviewAttempts, 1);
  assert.equal(abortCalls, 1);
  assert.equal(judgeCalls, 0);
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
    },
    structuredOutputValidator: {
      validate() {
        validateCalls += 1;
        return { schemaVersion: 2, findings: [] };
      },
      validateWithReport() {
        validateCalls += 1;
        return { payload: { schemaVersion: 2, findings: [] }, report: [] };
      },
      filterByAcceptance(payload: FindingsPayload) {
        return payload;
      },
      filterByAcceptanceWithReport(payload: FindingsPayload) {
        return { payload, report: [] };
      },
      validateWithDispositions() {
        return { schemaVersion: 2, findingUpdates: [], dispositions: [] };
      },
      validateDispositionCompleteness() {}
    }
  });

  await assert.rejects(
    () =>
      runner.run({
        step: createStructuredTestStep({}),
        context,
        outputBaseDir: "/workspace/output",
        repoRoot: "/workspace/repo",
        signal: controller.signal
      }),
    (error: unknown) => error instanceof SessionTurnAbortedError
  );
  assert.equal(reviewAttempts, 1);
  assert.equal(abortCalls, 1);
  assert.equal(validateCalls, 0);
});
