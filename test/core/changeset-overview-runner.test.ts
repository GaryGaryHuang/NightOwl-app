import assert from "node:assert/strict";
import test from "node:test";

import {
  ChangesetOverviewRunner
} from "../../src/core/changeset-overview-runner.ts";

test("ChangesetOverviewRunner builds Step 0 input from changeset entries and user context", async () => {
  const prompts = [];
  const runner = new ChangesetOverviewRunner({
    reviewSessionFactory: {
      async createSession() {
        return {
          async sendAndWait(prompt) {
            prompts.push(prompt);
            return "## Changeset Overview\n- 調整範圍：feature";
          }
        };
      }
    }
  });

  const runContext = await runner.run({
    model: "gpt-5.1-codex-mini",
    workingDirectory: "/workspace/repo",
    outputBaseDir: "/workspace/repo/packages/app",
    repoRoot: "/workspace/repo",
    userContext: ["PR-123", "https://example.com/spec"],
    changedFilesList: ["M\tsrc/app.ts", "D\tobsolete.txt"]
  });

  assert.equal(runContext.changesetOverview, "## Changeset Overview\n- 調整範圍：feature");
  assert.deepEqual(runContext.userContext, [
    "PR-123",
    "https://example.com/spec"
  ]);
  assert.match(prompts[0], /M\tsrc\/app\.ts/u);
  assert.match(prompts[0], /D\tobsolete\.txt/u);
  assert.match(prompts[0], /PR-123/u);
  assert.match(prompts[0], /https:\/\/example\.com\/spec/u);
});

test("ChangesetOverviewRunner retries once with a fresh session when the first response is blank", async () => {
  const prompts = [];
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
    model: "gpt-5.1-codex-mini",
    outputBaseDir: "/workspace/repo/packages/app",
    repoRoot: "/workspace/repo",
    changedFilesList: ["M\tsrc/app.ts"],
    userContext: []
  });

  assert.equal(createCalls, 2);
  assert.equal(runContext.changesetOverview, "## Changeset Overview\n- 調整範圍：retry");
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
        model: "gpt-5.1-codex-mini",
        outputBaseDir: "/workspace/repo/packages/app",
        repoRoot: "/workspace/repo",
        changedFilesList: ["M\tsrc/app.ts"],
        userContext: []
      }),
    /changeset overview/i
  );
  assert.equal(createCalls, 2);
});
