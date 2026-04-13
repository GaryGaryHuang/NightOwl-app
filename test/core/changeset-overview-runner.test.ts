import assert from "node:assert/strict";
import test from "node:test";

import {
  ChangesetOverviewRunner
} from "../../src/core/changeset-overview-runner.ts";
import {
  SessionExecutor,
  SessionTurnAbortedError
} from "../../src/services/session-executor.ts";

function createRecordingRunner(response = "## Changeset Overview\n- 調整範圍：feature") {
  const prompts: string[] = [];
  const runner = new ChangesetOverviewRunner({
    reviewSessionFactory: {
      async createSession() {
        return {
          async sendAndWait(prompt) {
            prompts.push(prompt);
            return response;
          }
        };
      }
    }
  });

  return {
    prompts,
    runner
  };
}

// A blank/undefined first response triggers a retry with a fresh session
// (a new `createSession` call), not a re-send on the same session.
test("ChangesetOverviewRunner retries once with a fresh session when the first response is blank", async () => {
  const prompts: string[] = [];
  let createCalls = 0;
  const runner = new ChangesetOverviewRunner({
    reviewSessionFactory: {
      async createSession() {
        createCalls += 1;

        return {
          async sendAndWait(prompt) {
            prompts.push(prompt);
            return createCalls === 1 ? undefined : "## Changeset Overview\n- 調整範圍：retry";
          }
        };
      }
    }
  });

  const runContext = await runner.run({
    model: "gpt-5.4-mini",
    outputBaseDir: "/workspace/repo",
    repoRoot: "/workspace/repo",
    changedFilesList: ["M\tsrc/app.ts"],
    userContext: []
  });

  assert.equal(createCalls, 2);
  assert.equal(runContext.changesetOverview, "## Changeset Overview\n- 調整範圍：retry\n");
  assert.equal(prompts.length, 2);
});

test("ChangesetOverviewRunner fails after two empty responses", async () => {
  let createCalls = 0;
  const runner = new ChangesetOverviewRunner({
    reviewSessionFactory: {
      async createSession() {
        createCalls += 1;

        return {
          async sendAndWait() {
            return "   ";
          }
        };
      }
    }
  });

  await assert.rejects(
    () =>
      runner.run({
        model: "gpt-5.4-mini",
        outputBaseDir: "/workspace/repo",
        repoRoot: "/workspace/repo",
        changedFilesList: ["M\tsrc/app.ts"],
        userContext: []
      }),
    /changeset overview/i
  );
  assert.equal(createCalls, 2);
});

test("ChangesetOverviewRunner aborts an in-flight Step 0 turn without consuming the retry budget", async () => {
  const controller = new AbortController();
  let createCalls = 0;
  let abortCalls = 0;
  let resolveSend:
    | ((value: { data?: { content?: string } } | undefined) => void)
    | undefined;
  const runner = new ChangesetOverviewRunner({
    reviewSessionFactory: {
      async createSession() {
        createCalls += 1;

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
        model: "gpt-5.4-mini",
        outputBaseDir: "/workspace/repo",
        repoRoot: "/workspace/repo",
        signal: controller.signal,
        changedFilesList: ["M\tsrc/app.ts"],
        userContext: []
      }),
    (error: unknown) => error instanceof SessionTurnAbortedError
  );
  assert.equal(createCalls, 1);
  assert.equal(abortCalls, 1);
});
