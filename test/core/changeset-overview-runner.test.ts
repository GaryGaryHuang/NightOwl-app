import assert from "node:assert/strict";
import test from "node:test";

import { ChangesetOverviewRunner } from "../../src/core/changeset-overview-runner.ts";
import type { ReviewChangesetEntry } from "../../src/providers/review-source-provider.ts";
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
  }[];
}

function buildChangeMapJson(options: ChangeMapJsonOptions = {}): string {
  const paths = options.paths ?? ["src/app.ts"];
  return JSON.stringify({
    reviewObjective: {
      summary: "Test review context.",
      requestedFocus: [],
      expectedBehaviorSummary: []
    },
    userBehavior: [],
    missingInformation: [],
    overviewMarkdown:
      options.overviewMarkdown ?? "## Changeset Overview\n- 調整範圍：feature",
    behaviorChanges: options.behaviorChanges ?? (
      paths.length === 0
        ? []
        : [
            {
              description: "review flow updates shared run context",
              files: paths
            }
          ]
    ),
    unresolvedUnknowns: []
  });
}

function createChangesetEntries(
  ...entries: ReviewChangesetEntry[]
): ReviewChangesetEntry[] {
  return entries;
}

test("ChangesetOverviewRunner produces a RunContext from a valid Step 0 ChangeMapReadinessV2 response", async () => {
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
    outputBaseDir: "/workspace/repo",
    repoRoot: "/workspace/repo",
    changesetEntries: createChangesetEntries({ status: "M", path: "src/app.ts" }),
    userContext: []
  });

  assert.equal(runContext.changesetOverview.behaviorChanges[0]?.files[0], "src/app.ts");
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
    outputBaseDir: "/workspace/repo",
    repoRoot: "/workspace/repo",
    changesetEntries: createChangesetEntries({ status: "M", path: "src/app.ts" }),
    userContext: []
  });

  assert.equal(createCalls, 2);
  assert.equal(
    runContext.changesetOverviewMarkdown,
    "## Changeset Overview\n- 調整範圍：retry\n"
  );
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /<validator_feedback format="json">/u);
  assert.match(prompts[1], /"actualSummary": "empty_response"/u);
});

test("ChangesetOverviewRunner retries once when the first response fails ChangeMapReadiness validation", async () => {
  let createCalls = 0;
  const prompts: string[] = [];
  const logMessages: string[] = [];
  const runner = new ChangesetOverviewRunner({
    onStep0LogEvent(event) {
      logMessages.push(event.message);
    },
    reviewSessionFactory: {
      async createSession() {
        createCalls += 1;

        return {
          async sendAndWait(prompt) {
            prompts.push(prompt);
            return createCalls === 1
              ? "## Changeset Overview\n- not JSON" // legacy Markdown
              : buildChangeMapJson();
          }
        };
      }
    }
  });

  const runContext = await runner.run({
    outputBaseDir: "/workspace/repo",
    repoRoot: "/workspace/repo",
    changesetEntries: createChangesetEntries({ status: "M", path: "src/app.ts" }),
    userContext: []
  });

  assert.equal(createCalls, 2);
  assert.equal(prompts.length, 2);
  assert.match(prompts[0], /<validator_feedback format="json">\nnull\n<\/validator_feedback>/u);
  assert.match(prompts[1], /<validator_feedback format="json">/u);
  assert.match(prompts[1], /"code": "PARSE"/u);
  assert.match(prompts[1], /"parseStage": "initial_parse"/u);
  assert.match(prompts[1], /Return a corrected JSON object/u);
  assert.equal(logMessages.length, 1);
  assert.match(logMessages[0]!, /Step 0 validation failed \(attempt 1, code=PARSE/u);
  assert.match(logMessages[0]!, /stage=initial_parse/u);
  assert.match(logMessages[0]!, /responseBytes=/u);
});

test("ChangesetOverviewRunner logs parse excerpts for trailing response content", async () => {
  let createCalls = 0;
  const logMessages: string[] = [];
  const runner = new ChangesetOverviewRunner({
    onStep0LogEvent(event) {
      logMessages.push(event.message);
    },
    reviewSessionFactory: {
      async createSession() {
        createCalls += 1;

        return {
          async sendAndWait() {
            return createCalls === 1
              ? '"not an object" trailing assistant text'
              : buildChangeMapJson();
          }
        };
      }
    }
  });

  await runner.run({
    outputBaseDir: "/workspace/repo",
    repoRoot: "/workspace/repo",
    changesetEntries: createChangesetEntries({ status: "M", path: "src/app.ts" }),
    userContext: []
  });

  assert.equal(logMessages.length, 1);
  assert.match(logMessages[0]!, /position=16/u);
  assert.match(logMessages[0]!, /line=1/u);
  assert.match(logMessages[0]!, /column=17/u);
  assert.match(logMessages[0]!, /excerpt=/u);
  assert.match(logMessages[0]!, /<<<ERROR>>>trailing assistant text/u);
});

test("ChangesetOverviewRunner logs successful syntax repairs", async () => {
  const logMessages: string[] = [];
  const runner = new ChangesetOverviewRunner({
    onStep0LogEvent(event) {
      logMessages.push(event.message);
    },
    reviewSessionFactory: {
      async createSession() {
        return {
          async sendAndWait() {
            return ["Here is the result:", buildChangeMapJson(), "Done."].join("\n");
          }
        };
      }
    }
  });

  await runner.run({
    outputBaseDir: "/workspace/repo",
    repoRoot: "/workspace/repo",
    changesetEntries: createChangesetEntries({ status: "M", path: "src/app.ts" }),
    userContext: []
  });

  assert.equal(logMessages.length, 1);
  assert.match(logMessages[0]!, /Step 0 JSON syntax repair applied \(attempt 1/u);
  assert.match(logMessages[0]!, /repair=object_extraction/u);
  assert.match(logMessages[0]!, /responseBytes=/u);
  assert.match(logMessages[0]!, /parsedBytes=/u);
});

test("ChangesetOverviewRunner retry feedback includes structured enum diagnostics", async () => {
  let createCalls = 0;
  const prompts: string[] = [];
  const invalidJson = JSON.stringify({
    reviewObjective: {
      summary: "Test review context.",
      requestedFocus: [],
      expectedBehaviorSummary: []
    },
    userBehavior: [{ statement: "x", confidence: "wrong" }],
    missingInformation: [],
    overviewMarkdown: "## Changeset Overview\n- 調整範圍：feature",
    behaviorChanges: [],
    unresolvedUnknowns: []
  });
  const runner = new ChangesetOverviewRunner({
    reviewSessionFactory: {
      async createSession() {
        createCalls += 1;

        return {
          async sendAndWait(prompt) {
            prompts.push(prompt);
            return createCalls === 1
              ? invalidJson
              : buildChangeMapJson();
          }
        };
      }
    }
  });

  await runner.run({
    outputBaseDir: "/workspace/repo",
    repoRoot: "/workspace/repo",
    changesetEntries: createChangesetEntries({ status: "M", path: "src/app.ts" }),
    userContext: []
  });

  assert.equal(createCalls, 2);
  assert.match(prompts[1], /"code": "SCHEMA"/u);
  assert.match(prompts[1], /"offendingPath": "userBehavior\[0\]\.confidence"/u);
  assert.match(prompts[1], /"allowedValues": \[/u);
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
        outputBaseDir: "/workspace/repo",
        repoRoot: "/workspace/repo",
        changesetEntries: createChangesetEntries({ status: "M", path: "src/app.ts" }),
        userContext: []
      }),
    /Step 0 ChangeMapReadiness validation failed \[PARSE\]/
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
        outputBaseDir: "/workspace/repo",
        repoRoot: "/workspace/repo",
        changesetEntries: createChangesetEntries({ status: "M", path: "src/app.ts" }),
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
            return buildChangeMapJson({
              paths: ["src/new.ts"]
            });
          }
        };
      }
    }
  });

  const runContext = await runner.run({
    outputBaseDir: "/workspace/repo",
    repoRoot: "/workspace/repo",
    changesetEntries: createChangesetEntries({
      status: "R",
      similarityScore: 100,
      previousPath: "src/old.ts",
      path: "src/new.ts"
    }),
    userContext: []
  });

  assert.equal(runContext.changesetFiles[0].path, "src/new.ts");
});

test("ChangesetOverviewRunner accepts copied paths as added host descriptors", async () => {
  const prompts: string[] = [];
  const runner = new ChangesetOverviewRunner({
    reviewSessionFactory: {
      async createSession() {
        return {
          async sendAndWait(prompt) {
            prompts.push(prompt);
            return buildChangeMapJson({
              paths: ["src/copied.ts"]
            });
          }
        };
      }
    }
  });

  const runContext = await runner.run({
    outputBaseDir: "/workspace/repo",
    repoRoot: "/workspace/repo",
    changesetEntries: createChangesetEntries({
      status: "C",
      similarityScore: 75,
      previousPath: "src/original.ts",
      path: "src/copied.ts"
    }),
    userContext: []
  });

  assert.match(prompts[0]!, /<changed_files_json format="json">/u);
  assert.match(prompts[0]!, /"originalStatus": "C"/u);
  assert.match(prompts[0]!, /"copiedAsAdded": true/u);
  assert.match(prompts[0]!, /A\tsrc\/copied\.ts/);
  assert.doesNotMatch(prompts[0]!, /C75\tsrc\/original\.ts\tsrc\/copied\.ts/);
  assert.equal(runContext.changesetFiles[0].path, "src/copied.ts");
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
    outputBaseDir: "/workspace/repo",
    repoRoot: "/workspace/repo",
    changesetEntries: [],
    userContext: []
  });

  assert.equal(runContext.changesetFiles.length, 0);
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
        outputBaseDir: "/workspace/repo",
        repoRoot: "/workspace/repo",
        signal: controller.signal,
        changesetEntries: createChangesetEntries({ status: "M", path: "src/app.ts" }),
        userContext: []
      }),
    (error: unknown) => error instanceof SessionTurnAbortedError
  );
  assert.equal(createCalls, 1);
  assert.equal(abortCalls, 1);
});
