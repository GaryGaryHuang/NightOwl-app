import assert from "node:assert/strict";
import test from "node:test";

import {
  stopClientManagerWithTimeout
} from "../../src/services/copilot-client-shutdown.ts";
import {
  CopilotClientManager,
  type CopilotClientLike
} from "../../src/services/copilot-client-manager.ts";

interface ShutdownClientManagerDoubleOptions {
  stopImpl?: () => Promise<readonly Error[] | void>;
  forceStopImpl?: () => Promise<unknown>;
}

function createShutdownClientManagerDouble(
  options: ShutdownClientManagerDoubleOptions = {}
): {
  calls: { stop: number; forceStop: number };
  clientManager: {
    stop(): Promise<readonly Error[]>;
    forceStop(): Promise<unknown>;
  };
} {
  const calls = {
    stop: 0,
    forceStop: 0
  };

  return {
    calls,
    clientManager: {
      async stop() {
        calls.stop += 1;
        return (await options.stopImpl?.()) ?? [];
      },
      async forceStop() {
        calls.forceStop += 1;
        return await (options.forceStopImpl?.() ?? Promise.resolve());
      }
    }
  };
}

test("stopClientManagerWithTimeout resolves after stop() when shutdown completes before the timeout", async () => {
  const fixture = createShutdownClientManagerDouble();

  const cleanupErrors = await stopClientManagerWithTimeout(fixture.clientManager, 10);

  assert.deepEqual(cleanupErrors, []);
  assert.deepEqual(fixture.calls, {
    stop: 1,
    forceStop: 0
  });
});

test("stopClientManagerWithTimeout returns graceful stop() cleanup diagnostics", async () => {
  const cleanupErrors = [new Error("cleanup warning")];
  const fixture = createShutdownClientManagerDouble({
    async stopImpl() {
      return cleanupErrors;
    }
  });

  const result = await stopClientManagerWithTimeout(fixture.clientManager, 10);

  assert.equal(result, cleanupErrors);
  assert.deepEqual(fixture.calls, {
    stop: 1,
    forceStop: 0
  });
});

test("stopClientManagerWithTimeout falls back to forceStop() when stop() exceeds the timeout", async () => {
  const fixture = createShutdownClientManagerDouble({
    async stopImpl() {
      return await new Promise<void>(() => {});
    }
  });

  const cleanupErrors = await stopClientManagerWithTimeout(fixture.clientManager, 0);

  assert.deepEqual(cleanupErrors, []);
  assert.deepEqual(fixture.calls, {
    stop: 1,
    forceStop: 1
  });
});

test("stopClientManagerWithTimeout force-stops the active Copilot client without waiting behind a hanging stop()", async () => {
  const lifecycle: string[] = [];
  const client: CopilotClientLike = {
    async start() {
      lifecycle.push("start");
    },
    async stop() {
      lifecycle.push("stop");
      return await new Promise<readonly Error[]>(() => {});
    },
    async forceStop() {
      lifecycle.push("forceStop");
    },
    async createSession() {
      throw new Error("createSession should not be called in this test");
    }
  };
  const manager = new CopilotClientManager({ createClient: () => client });

  await manager.start();

  const shutdown = stopClientManagerWithTimeout(manager, 0);
  const outcome = await Promise.race([
    shutdown.then(() => "completed" as const),
    new Promise<"hung">((resolve) => {
      setTimeout(() => resolve("hung"), 25);
    })
  ]);

  assert.equal(outcome, "completed");
  assert.deepEqual(lifecycle, ["start", "stop", "forceStop"]);
  assert.throws(
    () => manager.getClient(),
    /Copilot client has not been started\./
  );
});

test("stopClientManagerWithTimeout surfaces a fast stop() rejection without calling forceStop()", async () => {
  const stopError = new Error("stop failed");
  const fixture = createShutdownClientManagerDouble({
    async stopImpl() {
      throw stopError;
    }
  });

  await assert.rejects(
    () => stopClientManagerWithTimeout(fixture.clientManager, 0),
    (error: unknown) => error === stopError
  );

  assert.deepEqual(fixture.calls, {
    stop: 1,
    forceStop: 0
  });
});

test("stopClientManagerWithTimeout surfaces a forceStop() rejection after a shutdown timeout", async () => {
  const forceStopError = new Error("forceStop failed");
  const fixture = createShutdownClientManagerDouble({
    async stopImpl() {
      return await new Promise<void>(() => {});
    },
    async forceStopImpl() {
      throw forceStopError;
    }
  });

  await assert.rejects(
    () => stopClientManagerWithTimeout(fixture.clientManager, 0),
    (error: unknown) => error === forceStopError
  );

  assert.deepEqual(fixture.calls, {
    stop: 1,
    forceStop: 1
  });
});
