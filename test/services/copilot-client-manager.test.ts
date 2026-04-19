import assert from "node:assert/strict";
import test from "node:test";

import {
  CopilotClientManager
} from "../../src/services/copilot-client-manager.ts";
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
