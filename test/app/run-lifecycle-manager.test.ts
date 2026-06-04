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

interface FakeTtyInput {
  isTTY?: boolean;
  isRaw?: boolean;
  setRawMode(mode: boolean): void;
  isPaused(): boolean;
  on(event: "data", handler: (chunk: Buffer) => void): void;
  off(event: "data", handler: (chunk: Buffer) => void): void;
  resume(): void;
  pause(): void;
  emitData(chunk: Buffer): void;
  readonly rawModeCalls: boolean[];
  readonly resumed: boolean;
  readonly paused: boolean;
  readonly flowing: boolean;
  readonly dataListenerCount: number;
}

function createFakeTtyInput(options: {
  isTTY?: boolean;
  initiallyPaused?: boolean;
  setRawModeError?: Error;
} = {}): FakeTtyInput {
  const emitter = new EventEmitter();
  const rawModeCalls: boolean[] = [];
  let isRaw = false;
  let resumed = false;
  let paused = false;
  let flowing = !(options.initiallyPaused ?? true);

  return {
    isTTY: options.isTTY ?? true,
    get isRaw() {
      return isRaw;
    },
    setRawMode(mode: boolean) {
      if (options.setRawModeError) {
        throw options.setRawModeError;
      }
      isRaw = mode;
      rawModeCalls.push(mode);
    },
    isPaused() {
      return !flowing;
    },
    on(event, handler) {
      emitter.on(event, handler);
    },
    off(event, handler) {
      emitter.off(event, handler);
    },
    resume() {
      resumed = true;
      flowing = true;
    },
    pause() {
      paused = true;
      flowing = false;
    },
    emitData(chunk: Buffer) {
      emitter.emit("data", chunk);
    },
    get rawModeCalls() {
      return rawModeCalls;
    },
    get resumed() {
      return resumed;
    },
    get paused() {
      return paused;
    },
    get flowing() {
      return flowing;
    },
    get dataListenerCount() {
      return emitter.listenerCount("data");
    }
  };
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

// ─── TTY raw-mode Ctrl+C echo suppression ───────────────────────────────────

test("RunLifecycleManager enables raw mode on a TTY and restores it afterwards", async () => {
  const signalSource = createFakeSignalSource();
  const ttyInput = createFakeTtyInput({ isTTY: true });
  const manager = new RunLifecycleManager({ signalSource, ttyInput });

  await manager.run(async () => {
    assert.deepEqual(ttyInput.rawModeCalls, [true]);
    assert.equal(ttyInput.resumed, true);
    assert.equal(ttyInput.dataListenerCount, 1);
    return "done";
  });

  assert.deepEqual(ttyInput.rawModeCalls, [true, false]);
  assert.equal(ttyInput.paused, true);
  assert.equal(ttyInput.dataListenerCount, 0);
});

test("RunLifecycleManager aborts with SIGINT when the ETX byte arrives on a raw TTY", async () => {
  const signalSource = createFakeSignalSource();
  const ttyInput = createFakeTtyInput({ isTTY: true });
  const manager = new RunLifecycleManager({ signalSource, ttyInput });

  await assert.rejects(
    () =>
      manager.run(async (signal) => {
        ttyInput.emitData(Buffer.from([0x03]));
        assert.ok(signal.aborted, "signal should be aborted after Ctrl+C byte");
        assert.equal(signal.reason, "SIGINT");
        throw new Error("interrupted");
      }),
    { message: "interrupted" }
  );

  assert.deepEqual(ttyInput.rawModeCalls, [true, false]);
});

test("RunLifecycleManager ignores non-ETX stdin bytes", async () => {
  const signalSource = createFakeSignalSource();
  const ttyInput = createFakeTtyInput({ isTTY: true });
  const manager = new RunLifecycleManager({ signalSource, ttyInput });

  await manager.run(async (signal) => {
    ttyInput.emitData(Buffer.from("hello\n"));
    assert.ok(!signal.aborted, "ordinary input must not abort the run");
    return "done";
  });
});

test("RunLifecycleManager does not enable raw mode when stdin is not a TTY", async () => {
  const signalSource = createFakeSignalSource();
  const ttyInput = createFakeTtyInput({ isTTY: false });
  const manager = new RunLifecycleManager({ signalSource, ttyInput });

  await manager.run(async () => "done");

  assert.deepEqual(ttyInput.rawModeCalls, []);
  assert.equal(ttyInput.resumed, false);
  assert.equal(ttyInput.dataListenerCount, 0);
});

test("RunLifecycleManager still cleans up listeners and stops client when raw-mode setup throws", async () => {
  const signalSource = createFakeSignalSource();
  const ttyInput = createFakeTtyInput({
    isTTY: true,
    setRawModeError: new Error("ENOTTY")
  });
  const { calls, clientManager } = createLifecycleTracker();
  const manager = new RunLifecycleManager({
    clientManager,
    signalSource,
    ttyInput
  });

  await manager.run(async () => "done");

  assert.deepEqual(calls, ["start", "stop"]);
  assert.equal(signalSource.listenerCount("SIGINT"), 0);
  assert.equal(signalSource.listenerCount("SIGTERM"), 0);
  assert.equal(ttyInput.dataListenerCount, 0);
});

test("RunLifecycleManager restores stdin to its prior paused state", async () => {
  const signalSource = createFakeSignalSource();
  const ttyInput = createFakeTtyInput({ isTTY: true, initiallyPaused: true });
  const manager = new RunLifecycleManager({ signalSource, ttyInput });

  await manager.run(async () => {
    assert.equal(ttyInput.flowing, true, "stdin should flow during the run");
    return "done";
  });

  assert.equal(ttyInput.flowing, false, "stdin should be paused again afterwards");
});

test("RunLifecycleManager leaves stdin flowing when it was already flowing", async () => {
  const signalSource = createFakeSignalSource();
  const ttyInput = createFakeTtyInput({ isTTY: true, initiallyPaused: false });
  const manager = new RunLifecycleManager({ signalSource, ttyInput });

  await manager.run(async () => "done");

  assert.equal(
    ttyInput.flowing,
    true,
    "an already-flowing stdin must not be paused on restore"
  );
});

test("RunLifecycleManager nesting keeps stdin flowing for the outer run after the inner run restores", async () => {
  const signalSource = createFakeSignalSource();
  const ttyInput = createFakeTtyInput({ isTTY: true, initiallyPaused: true });
  const outer = new RunLifecycleManager({ signalSource, ttyInput });
  const inner = new RunLifecycleManager({ signalSource, ttyInput });

  await outer.run(async (outerSignal) => {
    assert.equal(ttyInput.flowing, true, "outer run should make stdin flow");

    await inner.run(async () => "inner-done");

    assert.equal(
      ttyInput.flowing,
      true,
      "inner restore must not pause stdin while the outer run is active"
    );

    // The outer run can still observe Ctrl+C after the inner run completes.
    ttyInput.emitData(Buffer.from([0x03]));
    assert.ok(outerSignal.aborted, "outer run should still detect Ctrl+C");
    assert.equal(outerSignal.reason, "SIGINT");
    return "outer-done";
  });

  assert.equal(ttyInput.flowing, false, "stdin restored to paused after outer run");
});
