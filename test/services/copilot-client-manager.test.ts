import assert from "node:assert/strict";
import test from "node:test";

import {
  CopilotClientManager,
  buildCopilotClientEnvironment,
  type CopilotClientLike
} from "../../src/services/copilot-client-manager.ts";
import {
  createLifecycleClientFactory
} from "../helpers/review-session-runtime-contract-fixture.ts";

function createTrackedClientFactory(
  lifecycle: string[],
  options: {
    failStartIds?: number[];
    startError?: Error;
  } = {}
): {
  createdClients: CopilotClientLike[];
  createClient: () => CopilotClientLike;
} {
  let nextId = 0;
  const createdClients: CopilotClientLike[] = [];
  const failedIds = new Set(options.failStartIds ?? []);

  return {
    createdClients,
    createClient() {
      const id = ++nextId;
      const client: CopilotClientLike = {
        async start() {
          lifecycle.push(`start:${id}`);
          if (failedIds.has(id)) {
            throw options.startError ?? new Error(`start failed for client ${id}`);
          }
        },
        async stop() {
          lifecycle.push(`stop:${id}`);
        },
        async forceStop() {
          lifecycle.push(`forceStop:${id}`);
        },
        async createSession() {
          throw new Error("createSession should not be called in this test");
        }
      };

      createdClients.push(client);
      return client;
    }
  };
}

test("CopilotClientManager stops the underlying client and clears the retained client", async () => {
  const lifecycle: string[] = [];
  const fixture = createTrackedClientFactory(lifecycle);
  const manager = new CopilotClientManager({ createClient: fixture.createClient });

  await manager.start();
  assert.equal(manager.getClient(), fixture.createdClients[0]);
  await manager.stop();

  assert.deepEqual(lifecycle, ["start:1", "stop:1"]);
  assert.throws(
    () => manager.getClient(),
    /Copilot client has not been started\./
  );
});

test("CopilotClientManager forceStop() clears the retained client", async () => {
  const lifecycle: string[] = [];
  const fixture = createTrackedClientFactory(lifecycle);
  const manager = new CopilotClientManager({ createClient: fixture.createClient });

  await manager.start();
  assert.equal(manager.getClient(), fixture.createdClients[0]);
  await manager.forceStop();

  assert.deepEqual(lifecycle, ["start:1", "forceStop:1"]);
  assert.throws(
    () => manager.getClient(),
    /Copilot client has not been started\./
  );
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

test("buildCopilotClientEnvironment disables interactive pagers for review shell tools", () => {
  const env = buildCopilotClientEnvironment({
    HOME: "/Users/dev",
    GIT_PAGER: "less",
    PAGER: "more"
  });

  assert.equal(env.HOME, "/Users/dev");
  assert.equal(env.GIT_PAGER, "cat");
  assert.equal(env.PAGER, "cat");
});

test("CopilotClientManager does not retain a client when start() fails", async () => {
  const lifecycle: string[] = [];
  const startupError = new Error("startup failed");
  const fixture = createTrackedClientFactory(lifecycle, {
    failStartIds: [1],
    startError: startupError
  });
  const manager = new CopilotClientManager({ createClient: fixture.createClient });

  await assert.rejects(
    () => manager.start(),
    (error: unknown) => error === startupError
  );

  assert.deepEqual(lifecycle, ["start:1"]);
  assert.equal(fixture.createdClients.length, 1);
  assert.throws(
    () => manager.getClient(),
    /Copilot client has not been started\./
  );
});

test("CopilotClientManager creates a fresh client when restarted after stop()", async () => {
  const lifecycle: string[] = [];
  const fixture = createTrackedClientFactory(lifecycle);
  const manager = new CopilotClientManager({ createClient: fixture.createClient });

  await manager.start();
  const firstClient = manager.getClient();
  await manager.stop();
  await manager.start();
  const secondClient = manager.getClient();

  assert.deepEqual(lifecycle, ["start:1", "stop:1", "start:2"]);
  assert.equal(fixture.createdClients.length, 2);
  assert.equal(firstClient, fixture.createdClients[0]);
  assert.equal(secondClient, fixture.createdClients[1]);
  assert.notEqual(secondClient, firstClient);
});

test("CopilotClientManager serializes overlapping start() calls onto one client instance", async () => {
  const lifecycle: string[] = [];
  let releaseStart!: () => void;
  const startGate = new Promise<void>((resolve) => {
    releaseStart = resolve;
  });
  let createClientCalls = 0;
  const createdClients: CopilotClientLike[] = [];
  const manager = new CopilotClientManager({
    createClient() {
      const id = ++createClientCalls;
      const client: CopilotClientLike = {
        async start() {
          lifecycle.push(`start:${id}`);
          await startGate;
        },
        async stop() {
          lifecycle.push(`stop:${id}`);
        },
        async forceStop() {
          lifecycle.push(`forceStop:${id}`);
        },
        async createSession() {
          throw new Error("createSession should not be called in this test");
        }
      };

      createdClients.push(client);
      return client;
    }
  });

  const firstStart = manager.start();
  const secondStart = manager.start();

  releaseStart();
  await Promise.all([firstStart, secondStart]);

  assert.equal(createClientCalls, 1);
  assert.deepEqual(lifecycle, ["start:1"]);
  assert.equal(manager.getClient(), createdClients[0]);
});
