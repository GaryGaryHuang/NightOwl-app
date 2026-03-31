import assert from "node:assert/strict";
import test from "node:test";

import {
  CopilotAvailabilityChecker
} from "../../src/services/copilot-availability-checker.ts";

test("CopilotAvailabilityChecker starts, pings, and stops the client on success", async () => {
  const calls: string[] = [];
  const checker = new CopilotAvailabilityChecker({
    clientManager: {
      async start() {
        calls.push("start");
      },
      getClient() {
        return {
          async ping(message?: string) {
            calls.push(`ping:${message}`);
            return { message: message ?? "", timestamp: Date.now() };
          }
        };
      },
      async stop() {
        calls.push("stop");
      },
      async forceStop() {
        calls.push("forceStop");
      }
    }
  });

  await checker.check();

  assert.deepEqual(calls, ["start", "ping:health check", "stop"]);
});

test("CopilotAvailabilityChecker surfaces startup failures", async () => {
  const checker = new CopilotAvailabilityChecker({
    clientManager: {
      async start() {
        throw new Error("startup failed");
      },
      getClient() {
        throw new Error("unreachable");
      },
      async stop() {},
      async forceStop() {}
    }
  });

  await assert.rejects(() => checker.check(), /startup failed/u);
});

test("CopilotAvailabilityChecker preserves probe failures even if later cleanup also fails", async () => {
  const checker = new CopilotAvailabilityChecker({
    clientManager: {
      async start() {},
      getClient() {
        return {
          async ping() {
            throw new Error("probe failed");
          }
        };
      },
      async stop() {
        throw new Error("cleanup failed");
      },
      async forceStop() {
        throw new Error("forceStop failed");
      }
    }
  });

  await assert.rejects(() => checker.check(), /probe failed/u);
});

test("CopilotAvailabilityChecker falls back to forceStop when graceful stop times out", async () => {
  const calls: string[] = [];
  const checker = new CopilotAvailabilityChecker({
    gracefulShutdownTimeoutMs: 0,
    clientManager: {
      async start() {
        calls.push("start");
      },
      getClient() {
        return {
          async ping() {
            calls.push("ping");
            return { message: "health check", timestamp: Date.now() };
          }
        };
      },
      async stop() {
        calls.push("stop");
        return new Promise<void>(() => {});
      },
      async forceStop() {
        calls.push("forceStop");
      }
    }
  });

  await checker.check();

  assert.deepEqual(calls, ["start", "ping", "stop", "forceStop"]);
});

test("CopilotAvailabilityChecker fails when cleanup fails after a successful probe", async () => {
  const checker = new CopilotAvailabilityChecker({
    clientManager: {
      async start() {},
      getClient() {
        return {
          async ping() {
            return { message: "health check", timestamp: Date.now() };
          }
        };
      },
      async stop() {
        throw new Error("stop failed");
      },
      async forceStop() {
        throw new Error("forceStop failed");
      }
    }
  });

  await assert.rejects(() => checker.check(), /stop failed/u);
});