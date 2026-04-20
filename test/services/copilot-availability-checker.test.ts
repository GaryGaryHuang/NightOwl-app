import assert from "node:assert/strict";
import test from "node:test";

import {
  CopilotAvailabilityChecker
} from "../../src/services/copilot-availability-checker.ts";

interface AvailabilityClientManagerDoubleOptions {
  startImpl?: () => Promise<void>;
  pingImpl?: (message?: string) => Promise<{ message: string; timestamp: number }>;
  stopImpl?: () => Promise<unknown>;
  forceStopImpl?: () => Promise<unknown>;
}

function createAvailabilityClientManagerDouble(
  options: AvailabilityClientManagerDoubleOptions = {}
): {
  calls: { start: number; stop: number; forceStop: number };
  pingMessages: string[];
  clientManager: {
    start(): Promise<void>;
    getClient(): {
      ping(message?: string): Promise<{ message: string; timestamp: number }>;
    };
    stop(): Promise<unknown>;
    forceStop(): Promise<unknown>;
  };
} {
  const calls = {
    start: 0,
    stop: 0,
    forceStop: 0
  };
  const pingMessages: string[] = [];

  return {
    calls,
    pingMessages,
    clientManager: {
      async start() {
        calls.start += 1;
        await options.startImpl?.();
      },
      getClient() {
        return {
          async ping(message?: string) {
            pingMessages.push(message ?? "");
            return await (
              options.pingImpl?.(message) ??
              Promise.resolve({
                message: message ?? "",
                timestamp: 0
              })
            );
          }
        };
      },
      async stop() {
        calls.stop += 1;
        return await (options.stopImpl?.() ?? Promise.resolve());
      },
      async forceStop() {
        calls.forceStop += 1;
        return await (options.forceStopImpl?.() ?? Promise.resolve());
      }
    }
  };
}

test("CopilotAvailabilityChecker starts, pings, and stops the client on success", async () => {
  const fixture = createAvailabilityClientManagerDouble();
  const checker = new CopilotAvailabilityChecker({
    pingMessage: "copilot health probe",
    clientManager: fixture.clientManager
  });

  await checker.check();

  assert.deepEqual(fixture.calls, {
    start: 1,
    stop: 1,
    forceStop: 0
  });
  assert.deepEqual(fixture.pingMessages, ["copilot health probe"]);
});

test("CopilotAvailabilityChecker surfaces startup failures", async () => {
  const startupError = new Error("startup failed");
  const fixture = createAvailabilityClientManagerDouble({
    async startImpl() {
      throw startupError;
    }
  });
  const checker = new CopilotAvailabilityChecker({
    clientManager: fixture.clientManager
  });

  await assert.rejects(
    () => checker.check(),
    (error: unknown) => error === startupError
  );

  assert.deepEqual(fixture.calls, {
    start: 1,
    stop: 1,
    forceStop: 0
  });
  assert.deepEqual(fixture.pingMessages, []);
});

test("CopilotAvailabilityChecker preserves probe failures even if later cleanup also fails", async () => {
  const probeError = new Error("probe failed");
  const checker = new CopilotAvailabilityChecker({
    clientManager: createAvailabilityClientManagerDouble({
      async pingImpl() {
        throw probeError;
      },
      async stopImpl() {
        throw new Error("cleanup failed");
      }
    }).clientManager
  });

  await assert.rejects(
    () => checker.check(),
    (error: unknown) => error === probeError
  );
});

test("CopilotAvailabilityChecker fails when cleanup fails after a successful probe", async () => {
  const stopError = new Error("stop failed");
  const fixture = createAvailabilityClientManagerDouble({
    async stopImpl() {
      throw stopError;
    }
  });
  const checker = new CopilotAvailabilityChecker({
    clientManager: fixture.clientManager
  });

  await assert.rejects(
    () => checker.check(),
    (error: unknown) => error === stopError
  );

  assert.deepEqual(fixture.calls, {
    start: 1,
    stop: 1,
    forceStop: 0
  });
  assert.deepEqual(fixture.pingMessages, ["health check"]);
});
