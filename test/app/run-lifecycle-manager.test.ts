import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  RunLifecycleManager,
  type SignalSource
} from "../../src/app/run-lifecycle-manager.ts";

function createFakeSignalSource(): SignalSource & EventEmitter {
  return new EventEmitter() as SignalSource & EventEmitter;
}

function createLifecycleTracker(overrides: {
  startError?: Error;
  stopImpl?: () => Promise<void>;
  forceStopImpl?: () => Promise<void>;
} = {}) {
  const calls: string[] = [];
  const clientManager = {
    async start() {
      calls.push("start");
      if (overrides.startError) {
        throw overrides.startError;
      }
    },
    async stop() {
      calls.push("stop");
      await overrides.stopImpl?.();
    },
    async forceStop() {
      calls.push("forceStop");
      await overrides.forceStopImpl?.();
    }
  };
  return { calls, clientManager };
}

// ─── Signal-to-abort translation ────────────────────────────────────────────

test("RunLifecycleManager SIGINT aborts the signal with reason SIGINT", async () => {
  const signalSource = createFakeSignalSource();
  const { clientManager } = createLifecycleTracker();
  const manager = new RunLifecycleManager({ clientManager, signalSource });

  await assert.rejects(
    () =>
      manager.run(async (signal) => {
        signalSource.emit("SIGINT");
        // AbortSignal abort is synchronous; check immediately
        assert.ok(signal.aborted, "signal should be aborted after SIGINT");
        assert.equal(signal.reason, "SIGINT");
        throw new Error("interrupted");
      }),
    { message: "interrupted" }
  );
});

test("RunLifecycleManager SIGTERM aborts the signal with reason SIGTERM", async () => {
  const signalSource = createFakeSignalSource();
  const { clientManager } = createLifecycleTracker();
  const manager = new RunLifecycleManager({ clientManager, signalSource });

  await assert.rejects(
    () =>
      manager.run(async (signal) => {
        signalSource.emit("SIGTERM");
        assert.ok(signal.aborted, "signal should be aborted after SIGTERM");
        assert.equal(signal.reason, "SIGTERM");
        throw new Error("interrupted");
      }),
    { message: "interrupted" }
  );
});

test("RunLifecycleManager keeps the first signal as the abort reason when SIGINT then SIGTERM arrive in quick succession", async () => {
  const signalSource = createFakeSignalSource();
  const { clientManager } = createLifecycleTracker();
  const manager = new RunLifecycleManager({ clientManager, signalSource });

  await assert.rejects(
    () =>
      manager.run(async (signal) => {
        signalSource.emit("SIGINT");
        signalSource.emit("SIGTERM");
        assert.equal(signal.reason, "SIGINT");
        throw new Error("interrupted");
      }),
    { message: "interrupted" }
  );
});

// ─── Listener cleanup ───────────────────────────────────────────────────────

test("RunLifecycleManager removes signal listeners after callback succeeds", async () => {
  const signalSource = createFakeSignalSource();
  const { clientManager } = createLifecycleTracker();
  const manager = new RunLifecycleManager({ clientManager, signalSource });

  assert.equal(signalSource.listenerCount("SIGINT"), 0);
  assert.equal(signalSource.listenerCount("SIGTERM"), 0);

  await manager.run(async () => {
    assert.equal(signalSource.listenerCount("SIGINT"), 1);
    assert.equal(signalSource.listenerCount("SIGTERM"), 1);
    return "done";
  });

  assert.equal(signalSource.listenerCount("SIGINT"), 0);
  assert.equal(signalSource.listenerCount("SIGTERM"), 0);
});

test("RunLifecycleManager removes signal listeners after callback throws", async () => {
  const signalSource = createFakeSignalSource();
  const { clientManager } = createLifecycleTracker();
  const manager = new RunLifecycleManager({ clientManager, signalSource });

  await assert.rejects(
    () =>
      manager.run(async () => {
        throw new Error("callback failure");
      }),
    { message: "callback failure" }
  );

  assert.equal(signalSource.listenerCount("SIGINT"), 0);
  assert.equal(signalSource.listenerCount("SIGTERM"), 0);
});

// ─── Client start/stop ordering ─────────────────────────────────────────────

test("RunLifecycleManager calls start before callback and stop after callback", async () => {
  const signalSource = createFakeSignalSource();
  const { calls, clientManager } = createLifecycleTracker();
  const manager = new RunLifecycleManager({ clientManager, signalSource });

  await manager.run(async () => {
    calls.push("callback");
    return "result";
  });

  assert.deepEqual(calls, ["start", "callback", "stop"]);
});

test("RunLifecycleManager calls stop after callback throws", async () => {
  const signalSource = createFakeSignalSource();
  const { calls, clientManager } = createLifecycleTracker();
  const manager = new RunLifecycleManager({ clientManager, signalSource });

  await assert.rejects(
    () =>
      manager.run(async () => {
        calls.push("callback");
        throw new Error("fail");
      }),
    { message: "fail" }
  );

  assert.deepEqual(calls, ["start", "callback", "stop"]);
});

// ─── Start failure ──────────────────────────────────────────────────────────

test("RunLifecycleManager does not call stop or forceStop when start fails", async () => {
  const signalSource = createFakeSignalSource();
  const { calls, clientManager } = createLifecycleTracker({
    startError: new Error("start failed")
  });
  const manager = new RunLifecycleManager({ clientManager, signalSource });

  await assert.rejects(() => manager.run(async () => "never"), {
    message: "start failed"
  });

  assert.deepEqual(calls, ["start"]);
});

test("RunLifecycleManager does not register signal listeners when start fails", async () => {
  const signalSource = createFakeSignalSource();
  const { clientManager } = createLifecycleTracker({
    startError: new Error("start failed")
  });
  const manager = new RunLifecycleManager({ clientManager, signalSource });

  await assert.rejects(() => manager.run(async () => "never"), {
    message: "start failed"
  });

  assert.equal(signalSource.listenerCount("SIGINT"), 0);
  assert.equal(signalSource.listenerCount("SIGTERM"), 0);
});

// ─── Callback return value propagation ──────────────────────────────────────

test("RunLifecycleManager propagates callback return value", async () => {
  const signalSource = createFakeSignalSource();
  const { clientManager } = createLifecycleTracker();
  const manager = new RunLifecycleManager({ clientManager, signalSource });

  const result = await manager.run(async () => ({ total: 42 }));
  assert.deepEqual(result, { total: 42 });
});

// ─── No clientManager ───────────────────────────────────────────────────────

test("RunLifecycleManager runs callback without client lifecycle when clientManager is absent", async () => {
  const signalSource = createFakeSignalSource();
  const manager = new RunLifecycleManager({ signalSource });

  const result = await manager.run(async (signal) => {
    assert.ok(!signal.aborted, "signal should not be aborted initially");
    return "no-client";
  });

  assert.equal(result, "no-client");
});

// ─── Signal listeners removed before stop ───────────────────────────────────

test("RunLifecycleManager removes listeners before calling stop on normal completion", async () => {
  const signalSource = createFakeSignalSource();
  let listenersAtStop = -1;

  const { clientManager } = createLifecycleTracker({
    stopImpl: async () => {
      listenersAtStop =
        signalSource.listenerCount("SIGINT") +
        signalSource.listenerCount("SIGTERM");
    }
  });
  const manager = new RunLifecycleManager({ clientManager, signalSource });

  await manager.run(async () => "done");

  assert.equal(listenersAtStop, 0, "listeners must be removed before stop()");
});

test("RunLifecycleManager removes listeners before calling stop after error", async () => {
  const signalSource = createFakeSignalSource();
  let listenersAtStop = -1;

  const { clientManager } = createLifecycleTracker({
    stopImpl: async () => {
      listenersAtStop =
        signalSource.listenerCount("SIGINT") +
        signalSource.listenerCount("SIGTERM");
    }
  });
  const manager = new RunLifecycleManager({ clientManager, signalSource });

  await assert.rejects(
    () =>
      manager.run(async () => {
        throw new Error("callback error");
      }),
    { message: "callback error" }
  );

  assert.equal(listenersAtStop, 0, "listeners must be removed before stop()");
});

// ─── Graceful shutdown timeout and forceStop ────────────────────────────────

test("RunLifecycleManager falls back to forceStop when stop exceeds timeout", async () => {
  const signalSource = createFakeSignalSource();
  const { calls, clientManager } = createLifecycleTracker({
    stopImpl: () => new Promise(() => {}) // never resolves
  });
  const manager = new RunLifecycleManager({
    clientManager,
    signalSource,
    gracefulShutdownTimeoutMs: 10
  });

  await manager.run(async () => "done");

  assert.ok(calls.includes("stop"), "stop should be called");
  assert.ok(calls.includes("forceStop"), "forceStop should be called after timeout");
});

test("RunLifecycleManager does not call forceStop when stop resolves within timeout", async () => {
  const signalSource = createFakeSignalSource();
  const { calls, clientManager } = createLifecycleTracker();
  const manager = new RunLifecycleManager({
    clientManager,
    signalSource,
    gracefulShutdownTimeoutMs: 5000
  });

  await manager.run(async () => "done");

  assert.deepEqual(calls, ["start", "stop"]);
});

test("RunLifecycleManager preserves the original callback error when forceStop follows a timed-out stop", async () => {
  const signalSource = createFakeSignalSource();
  const callbackError = new Error("callback failure");
  const { calls, clientManager } = createLifecycleTracker({
    stopImpl: () => new Promise(() => {})
  });
  const manager = new RunLifecycleManager({
    clientManager,
    signalSource,
    gracefulShutdownTimeoutMs: 10
  });

  await assert.rejects(
    () =>
      manager.run(async () => {
        throw callbackError;
      }),
    (err: unknown) => err === callbackError
  );

  assert.deepEqual(calls, ["start", "stop", "forceStop"]);
});

test("RunLifecycleManager preserves the original callback error when stop() rejects during cleanup", async () => {
  const signalSource = createFakeSignalSource();
  const callbackError = new Error("callback failure");
  const stopError = new Error("stop failed");
  const { calls, clientManager } = createLifecycleTracker({
    async stopImpl() {
      throw stopError;
    }
  });
  const manager = new RunLifecycleManager({ clientManager, signalSource });

  await assert.rejects(
    () =>
      manager.run(async () => {
        throw callbackError;
      }),
    (err: unknown) => err === callbackError
  );

  assert.deepEqual(calls, ["start", "stop"]);
});

test("RunLifecycleManager preserves the original callback error when forceStop() rejects after shutdown timeout", async () => {
  const signalSource = createFakeSignalSource();
  const callbackError = new Error("callback failure");
  const forceStopError = new Error("forceStop failed");
  const { calls, clientManager } = createLifecycleTracker({
    stopImpl: () => new Promise(() => {}),
    async forceStopImpl() {
      throw forceStopError;
    }
  });
  const manager = new RunLifecycleManager({
    clientManager,
    signalSource,
    gracefulShutdownTimeoutMs: 10
  });

  await assert.rejects(
    () =>
      manager.run(async () => {
        throw callbackError;
      }),
    (err: unknown) => err === callbackError
  );

  assert.deepEqual(calls, ["start", "stop", "forceStop"]);
});

test("RunLifecycleManager preserves a falsy callback rejection when cleanup also fails", async () => {
  const signalSource = createFakeSignalSource();
  const callbackError = 0;
  const { calls, clientManager } = createLifecycleTracker({
    async stopImpl() {
      throw new Error("stop failed");
    }
  });
  const manager = new RunLifecycleManager({ clientManager, signalSource });

  await assert.rejects(
    () =>
      manager.run(async () => {
        throw callbackError;
      }),
    (err: unknown) => err === callbackError
  );

  assert.deepEqual(calls, ["start", "stop"]);
});

// ─── Custom signalSource injection ──────────────────────────────────────────

test("RunLifecycleManager does not touch process listeners with custom signalSource", async () => {
  const signalSource = createFakeSignalSource();
  const { clientManager } = createLifecycleTracker();
  const sigintBefore = process.listenerCount("SIGINT");
  const sigtermBefore = process.listenerCount("SIGTERM");

  const manager = new RunLifecycleManager({ clientManager, signalSource });
  await manager.run(async () => "done");

  assert.equal(process.listenerCount("SIGINT"), sigintBefore);
  assert.equal(process.listenerCount("SIGTERM"), sigtermBefore);
});
