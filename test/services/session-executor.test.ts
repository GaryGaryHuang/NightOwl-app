import assert from "node:assert/strict";
import test from "node:test";

import {
  CopilotClientManager
} from "../../src/services/copilot-client-manager.ts";
import {
  SessionExecutor,
  SessionTurnAbortedError
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

// SessionExecutor must call disconnect() after every sendAndWait call regardless
// of success, empty response, or error — it owns the session lifecycle.
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

// Whitespace-only content is treated as an empty response (returns undefined)
// rather than forwarding meaningless content to the caller.
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

test("SessionExecutor requests session abort exactly once for an in-flight turn and rejects with SessionTurnAbortedError", async () => {
  const controller = new AbortController();
  const calls: string[] = [];
  let resolveSend:
    | ((value: { data?: { content?: string } } | undefined) => void)
    | undefined;

  const session = {
    async sendAndWait() {
      calls.push("sendAndWait");
      return await new Promise<{ data?: { content?: string } } | undefined>((resolve) => {
        resolveSend = resolve;
      });
    },
    async abort() {
      calls.push("abort");
      resolveSend?.(undefined);
    },
    async disconnect() {
      calls.push("disconnect");
    }
  };

  const executor = new SessionExecutor(session);
  const pending = executor.sendAndWait("analyze this changeset", 300_000, controller.signal);
  controller.abort("SIGINT");

  await assert.rejects(
    () => pending,
    (error: unknown) => error instanceof SessionTurnAbortedError
  );
  assert.deepEqual(calls, ["sendAndWait", "abort", "disconnect"]);
});

test("SessionExecutor does not send a late abort after the turn already settled", async () => {
  const controller = new AbortController();
  const calls: string[] = [];
  const session = {
    async sendAndWait() {
      calls.push("sendAndWait");
      return {
        data: {
          content: "## Changeset Overview\n- 調整範圍：test"
        }
      };
    },
    async abort() {
      calls.push("abort");
    },
    async disconnect() {
      calls.push("disconnect");
    }
  };

  const executor = new SessionExecutor(session);
  const response = await executor.sendAndWait(
    "analyze this changeset",
    300_000,
    controller.signal
  );
  controller.abort("SIGINT");

  assert.equal(response, "## Changeset Overview\n- 調整範圍：test");
  assert.deepEqual(calls, ["sendAndWait", "disconnect"]);
});

test("SessionExecutor rejects with SessionTurnAbortedError when the signal is already aborted before the turn starts", async () => {
  const controller = new AbortController();
  controller.abort("SIGINT");
  const calls: string[] = [];
  const session = {
    async sendAndWait() {
      calls.push("sendAndWait");
      return { data: { content: "should not happen" } };
    },
    async abort() {
      calls.push("abort");
    },
    async disconnect() {
      calls.push("disconnect");
    }
  };

  const executor = new SessionExecutor(session);

  await assert.rejects(
    () => executor.sendAndWait("analyze this changeset", 300_000, controller.signal),
    (error: unknown) => error instanceof SessionTurnAbortedError
  );
  assert.deepEqual(calls, ["disconnect"]);
});
