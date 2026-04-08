import assert from "node:assert/strict";
import test from "node:test";

import {
  ChangesetOverviewRunner,
  type ReviewSessionFactoryLike
} from "../../src/core/changeset-overview-runner.ts";
import {
  SessionExecutor,
  SessionTurnAbortedError
} from "../../src/services/session-executor.ts";
import {
  assertNightOwlSharedToolGuidance,
  assertTaggedBlockContains,
  assertTextContainsAll,
  assertTextExcludesAll
} from "../helpers/step-prompt-contract-fixture.ts";

type Step0Profile = Parameters<ReviewSessionFactoryLike["createSession"]>[0];

test("ChangesetOverviewRunner builds Step 0 input from changeset entries and user context", async () => {
  const profiles: Step0Profile[] = [];
  const prompts: string[] = [];
  const timeouts: number[] = [];
  const runner = new ChangesetOverviewRunner({
    reviewSessionFactory: {
      async createSession(profile) {
        profiles.push(profile);

        return {
          async sendAndWait(prompt, timeoutMs) {
            prompts.push(prompt);
            timeouts.push(timeoutMs ?? 0);
            return "## Changeset Overview\n- 調整範圍：feature";
          }
        };
      }
    }
  });

  const runContext = await runner.run({
    model: "gpt-5.4-mini",
    workingDirectory: "/workspace/repo",
    outputBaseDir: "/workspace/repo",
    repoRoot: "/workspace/repo",
    userContext: ["PR-123", "https://example.com/spec"],
    changedFilesList: ["M\tsrc/app.ts", "D\tobsolete.txt"]
  });

  assert.equal(runContext.changesetOverview, "## Changeset Overview\n- 調整範圍：feature\n");
  assert.deepEqual(runContext.userContext, [
    "PR-123",
    "https://example.com/spec"
  ]);

  // Step 0 uses Context7 by default so the LLM can retrieve library version info
  // from the changeset entries without needing a per-file retrieval step.
  assert.equal(profiles[0]?.knowledgeMode, "built-in-context7");
  assert.equal(profiles[0]?.dryRunStepContract, "changeset-overview");
  assert.equal(profiles[0]?.model, "gpt-5.4-mini");
  assert.equal(profiles[0]?.outputBaseDir, "/workspace/repo");
  assert.equal(profiles[0]?.repoRoot, "/workspace/repo");
  assert.equal(profiles[0]?.workingDirectory, "/workspace/repo");

  assertTextContainsAll(profiles[0]?.systemMessage ?? "", [
    "## Current Step: Changeset Overview",
    "This is a run-level step.",
    "Do not analyze every file in detail.",
    "Behavioral changes are business decisions",
    "Begin the response with `## Changeset Overview`."
  ]);
  assertNightOwlSharedToolGuidance(profiles[0]?.systemMessage ?? "");

  assertTaggedBlockContains(prompts[0] ?? "", "changed_files", [
    "M\tsrc/app.ts",
    "D\tobsolete.txt"
  ]);
  assertTaggedBlockContains(prompts[0] ?? "", "user_context", [
    "PR-123",
    "https://example.com/spec"
  ]);
  assertTextContainsAll(prompts[0] ?? "", [
    "Analyze the changeset across all files in <changed_files>",
    "## Changeset Overview",
    "- 調整範圍：",
    "- 跨檔案邊界：",
    "- 行為變更：",
    "- 測試覆蓋觀察："
  ]);
  assert.equal(timeouts[0], 300_000);
});

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
  assertTaggedBlockContains(prompts[0] ?? "", "changed_files", ["M\tsrc/app.ts"]);
  // When userContext is empty the <user_context> tag must be fully absent,
  // not present but empty, so the model does not encounter an empty XML block.
  assertTextExcludesAll(prompts[0] ?? "", [/<user_context>[\s\S]*<\/user_context>/u]);
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
