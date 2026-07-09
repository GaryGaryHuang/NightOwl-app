import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  CopilotAuthRunner,
  type CopilotAuthStatusClientLike,
  type CopilotAuthRunnerSpawnOptions,
  type SpawnedCopilotAuthProcess
} from "../../src/services/copilot-auth-runner.ts";

interface SpawnCall {
  command: string;
  args: string[];
  options: CopilotAuthRunnerSpawnOptions;
}

function createSpawnFixture(
  exit: { code: number | null; signal: NodeJS.Signals | null } = {
    code: 0,
    signal: null
  }
): {
  calls: SpawnCall[];
  spawnProcess: (
    command: string,
    args: string[],
    options: CopilotAuthRunnerSpawnOptions
  ) => SpawnedCopilotAuthProcess;
} {
  const calls: SpawnCall[] = [];

  return {
    calls,
    spawnProcess(command, args, options) {
      calls.push({ command, args, options });
      const child = new EventEmitter();
      queueMicrotask(() => child.emit("exit", exit.code, exit.signal));
      return child as SpawnedCopilotAuthProcess;
    }
  };
}

test("CopilotAuthRunner spawns the resolved native runtime with auth arguments", async () => {
  const fixture = createSpawnFixture();
  const runner = new CopilotAuthRunner({
    env: {
      COPILOT_CLI_PATH: "/nightowl/copilot",
      PAGER: "less"
    },
    workingDirectory: "/repo",
    spawnProcess: fixture.spawnProcess
  });

  await runner.run("login");

  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.calls[0]?.command, "/nightowl/copilot");
  assert.deepEqual(fixture.calls[0]?.args, ["login"]);
  assert.equal(fixture.calls[0]?.options.cwd, "/repo");
  assert.equal(fixture.calls[0]?.options.stdio, "inherit");
  assert.equal(fixture.calls[0]?.options.env.PAGER, "cat");
});

test("CopilotAuthRunner runs JavaScript runtime paths with the current Node executable", async () => {
  const fixture = createSpawnFixture();
  const runner = new CopilotAuthRunner({
    env: {
      COPILOT_CLI_PATH: "/nightowl/copilot/npm-loader.js"
    },
    nodeExecutable: "/usr/local/bin/node",
    spawnProcess: fixture.spawnProcess
  });

  await runner.run("login");

  assert.equal(fixture.calls[0]?.command, "/usr/local/bin/node");
  assert.deepEqual(fixture.calls[0]?.args, [
    "/nightowl/copilot/npm-loader.js",
    "login"
  ]);
});

test("CopilotAuthRunner rejects non-zero auth process exits", async () => {
  const fixture = createSpawnFixture({ code: 1, signal: null });
  const runner = new CopilotAuthRunner({
    env: {
      COPILOT_CLI_PATH: "/nightowl/copilot"
    },
    spawnProcess: fixture.spawnProcess
  });

  await assert.rejects(
    () => runner.run("login"),
    /GitHub Copilot auth login failed with exit code 1\./u
  );
});

test("CopilotAuthRunner prints authenticated status from the SDK auth probe", async () => {
  const lifecycle: string[] = [];
  const stdout: string[] = [];
  const runner = new CopilotAuthRunner({
    createStatusClient: () =>
      createStatusClient(lifecycle, {
        isAuthenticated: true,
        authType: "user",
        host: "https://github.com",
        login: "octocat",
        statusMessage: "Signed in"
      }),
    stdout: {
      log(message) {
        stdout.push(String(message));
      }
    }
  });

  await runner.run("status");

  assert.deepEqual(lifecycle, ["start", "getAuthStatus", "stop"]);
  assert.deepEqual(stdout, [
    [
      "GitHub Copilot is authenticated.",
      "Login: octocat",
      "Host: https://github.com",
      "Auth type: user",
      "Status: Signed in"
    ].join("\n")
  ]);
});

test("CopilotAuthRunner rejects unauthenticated SDK auth status", async () => {
  const lifecycle: string[] = [];
  const runner = new CopilotAuthRunner({
    createStatusClient: () =>
      createStatusClient(lifecycle, {
        isAuthenticated: false,
        statusMessage: "No authentication information found."
      })
  });

  await assert.rejects(
    () => runner.run("status"),
    /GitHub Copilot is not authenticated\. No authentication information found\./u
  );
  assert.deepEqual(lifecycle, ["start", "getAuthStatus", "stop"]);
});

function createStatusClient(
  lifecycle: string[],
  status: Awaited<ReturnType<CopilotAuthStatusClientLike["getAuthStatus"]>>
): CopilotAuthStatusClientLike {
  return {
    async start() {
      lifecycle.push("start");
    },
    async stop() {
      lifecycle.push("stop");
      return [];
    },
    async forceStop() {
      lifecycle.push("forceStop");
    },
    async getAuthStatus() {
      lifecycle.push("getAuthStatus");
      return status;
    }
  };
}
