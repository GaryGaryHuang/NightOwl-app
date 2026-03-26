import assert from "node:assert/strict";
import test from "node:test";

import {
  CopilotClientManager,
  SessionExecutor
} from "../../src/services/session-executor.ts";
import {
  createLifecycleClientFactory
} from "../helpers/review-session-runtime-contract-fixture.ts";

test("CopilotClientManager starts and stops the underlying client", async () => {
  const lifecycle: string[] = [];
  const manager = new CopilotClientManager({
    createClient: createLifecycleClientFactory(lifecycle)
  });

  await manager.start();
  await manager.stop();

  assert.deepEqual(lifecycle, ["start", "stop"]);
});

test("CopilotClientManager forceStop() forwards to the underlying client", async () => {
  const lifecycle: string[] = [];
  const manager = new CopilotClientManager({
    createClient: createLifecycleClientFactory(lifecycle)
  });

  await manager.start();
  await manager.forceStop();

  assert.deepEqual(lifecycle, ["start", "forceStop"]);
});

test("CopilotClientManager forceStop() is a no-op before startup", async () => {
  let createClientCalls = 0;
  const manager = new CopilotClientManager({
    createClient() {
      createClientCalls += 1;
      return createLifecycleClientFactory([], {
        forceStopShouldThrowBeforeStart: true
      })();
    }
  });

  await manager.forceStop();

  assert.equal(createClientCalls, 0);
});

test("SessionExecutor sendAndWait returns the assistant message content and disconnects afterwards", async () => {
  const calls: Array<[string, unknown?]> = [];
  const session = {
    async sendAndWait(prompt: { prompt: string }) {
      calls.push(["sendAndWait", prompt]);
      return {
        type: "assistant.message",
        data: {
          content: "## Changeset Overview\n- 調整範圍：test"
        }
      };
    },
    async disconnect() {
      calls.push(["disconnect"]);
    }
  };

  const executor = new SessionExecutor(session);
  const response = await executor.sendAndWait("analyze this changeset");

  assert.equal(response, "## Changeset Overview\n- 調整範圍：test");
  assert.deepEqual(calls, [
    ["sendAndWait", { prompt: "analyze this changeset" }],
    ["disconnect"]
  ]);
});

test("SessionExecutor returns undefined for empty assistant content and still disconnects", async () => {
  const calls: Array<[string, unknown?]> = [];
  const session = {
    async sendAndWait() {
      calls.push(["sendAndWait"]);
      return {
        type: "assistant.message",
        data: {
          content: "   "
        }
      };
    },
    async disconnect() {
      calls.push(["disconnect"]);
    }
  };

  const executor = new SessionExecutor(session);
  const response = await executor.sendAndWait("analyze this changeset");

  assert.equal(response, undefined);
  assert.deepEqual(calls, [["sendAndWait"], ["disconnect"]]);
});

test("SessionExecutor propagates sendAndWait failures and still disconnects", async () => {
  const calls: Array<[string, unknown?]> = [];
  const session = {
    async sendAndWait() {
      calls.push(["sendAndWait"]);
      throw new Error("copilot unavailable");
    },
    async disconnect() {
      calls.push(["disconnect"]);
    }
  };

  const executor = new SessionExecutor(session);

  await assert.rejects(
    () => executor.sendAndWait("analyze this changeset"),
    /copilot unavailable/u
  );
  assert.deepEqual(calls, [["sendAndWait"], ["disconnect"]]);
});
