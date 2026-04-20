import assert from "node:assert/strict";
import test from "node:test";

import { ChangesetOverviewRunner } from "../../src/core/changeset-overview-runner.ts";
import {
  SessionExecutor,
  SessionTurnAbortedError
} from "../../src/services/session-executor.ts";

interface ChangeMapJsonOptions {
  readonly overviewMarkdown?: string;
  readonly paths?: readonly string[];
  readonly behaviorChanges?: readonly {
    description: string;
    files: readonly string[];
    evidenceRefs: readonly string[];
  }[];
}

function buildChangeMapJson(options: ChangeMapJsonOptions = {}): string {
  const paths = options.paths ?? ["src/app.ts"];
  return JSON.stringify({
    schemaVersion: 1,
    overviewMarkdown:
      options.overviewMarkdown ?? "## Changeset Overview\n- 調整範圍：feature",
    changedFiles: paths.map((path) => ({
      path,
      status: "M",
      category: "feature",
      group: "review-flow",
      basis: "diff-inspected"
    })),
    fileGroups:
      paths.length === 0
        ? []
        : [
            {
              id: "G1",
              label: "review-flow",
              files: paths,
              observedChange: "review flow updates shared run context"
            }
          ],
    crossFileBoundaries: [],
    testCoverageObservations: [],
    behaviorChanges: options.behaviorChanges ?? [],
    evidenceRefs: [],
    unresolvedUnknowns: []
  });
}

test("ChangesetOverviewRunner produces a RunContext from a valid Step 0 ChangeMap response", async () => {
  const prompts: string[] = [];
  const profiles: unknown[] = [];
  const runner = new ChangesetOverviewRunner({
    reviewSessionFactory: {
      async createSession(profile) {
        profiles.push(profile);
        return {
          async sendAndWait(prompt) {
            prompts.push(prompt);
            return buildChangeMapJson();
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

  assert.equal(runContext.changesetOverview.schemaVersion, 1);
  assert.equal(runContext.changesetOverview.changedFiles.length, 1);
  assert.equal(runContext.changesetOverview.changedFiles[0].path, "src/app.ts");
  assert.equal(
    runContext.changesetOverviewMarkdown,
    "## Changeset Overview\n- 調整範圍：feature\n"
  );
  assert.equal(prompts.length, 1);
  assert.equal(profiles.length, 1);
  assert.equal((profiles[0] as { stepId: string }).stepId, "changeset-overview");
  assert.equal((profiles[0] as { knowledgeMode: string }).knowledgeMode, "built-in-context7");
  assert.equal((profiles[0] as { model: string }).model, "gpt-5.4-mini");
  assert.equal((profiles[0] as { outputBaseDir: string }).outputBaseDir, "/workspace/repo");
  assert.equal((profiles[0] as { repoRoot: string }).repoRoot, "/workspace/repo");
  assert.equal(typeof (profiles[0] as { systemMessage: unknown }).systemMessage, "string");
  assert.equal((profiles[0] as { workingDirectory: undefined }).workingDirectory, undefined);
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
            return createCalls === 1
              ? undefined
              : buildChangeMapJson({
                  overviewMarkdown: "## Changeset Overview\n- 調整範圍：retry"
                });
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
  assert.equal(
    runContext.changesetOverviewMarkdown,
    "## Changeset Overview\n- 調整範圍：retry\n"
  );
  assert.equal(prompts.length, 2);
});

test("ChangesetOverviewRunner retries once when the first response fails ChangeMap validation", async () => {
  let createCalls = 0;
  const runner = new ChangesetOverviewRunner({
    reviewSessionFactory: {
      async createSession() {
        createCalls += 1;

        return {
          async sendAndWait() {
            return createCalls === 1
              ? "## Changeset Overview\n- not JSON" // legacy Markdown
              : buildChangeMapJson();
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
  assert.equal(runContext.changesetOverview.schemaVersion, 1);
});

test("ChangesetOverviewRunner aborts after two consecutive validation failures", async () => {
  let createCalls = 0;
  const runner = new ChangesetOverviewRunner({
    reviewSessionFactory: {
      async createSession() {
        createCalls += 1;

        return {
          async sendAndWait() {
            return "## not json";
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
    /Step 0 ChangeMap validation failed \[PARSE\]/
  );
  assert.equal(createCalls, 2);
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

test("ChangesetOverviewRunner accepts a renamed path via R-style name-status entry", async () => {
  const runner = new ChangesetOverviewRunner({
    reviewSessionFactory: {
      async createSession() {
        return {
          async sendAndWait() {
            return buildChangeMapJson({ paths: ["src/new.ts"] });
          }
        };
      }
    }
  });

  const runContext = await runner.run({
    model: "gpt-5.4-mini",
    outputBaseDir: "/workspace/repo",
    repoRoot: "/workspace/repo",
    changedFilesList: ["R100\tsrc/old.ts\tsrc/new.ts"],
    userContext: []
  });

  assert.equal(runContext.changesetOverview.changedFiles[0].path, "src/new.ts");
});

test("ChangesetOverviewRunner accepts a zero-file changeset", async () => {
  const runner = new ChangesetOverviewRunner({
    reviewSessionFactory: {
      async createSession() {
        return {
          async sendAndWait() {
            return buildChangeMapJson({
              overviewMarkdown: "## Changeset Overview\n- 無檔案異動",
              paths: []
            });
          }
        };
      }
    }
  });

  const runContext = await runner.run({
    model: "gpt-5.4-mini",
    outputBaseDir: "/workspace/repo",
    repoRoot: "/workspace/repo",
    changedFilesList: [],
    userContext: []
  });

  assert.equal(runContext.changesetOverview.changedFiles.length, 0);
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
