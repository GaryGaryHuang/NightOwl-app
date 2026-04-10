import assert from "node:assert/strict";
import test from "node:test";
import { approveAll, type SessionConfig } from "@github/copilot-sdk";

import { JudgeSessionFactory } from "../../src/services/judge-session-factory.ts";
import {
  createRecordedConfigs,
  createSessionRecordingClientManager
} from "../helpers/review-session-runtime-contract-fixture.ts";

// Judge sessions use availableTools:[] (no tools) and streaming:false because
// the judge only needs to emit a single Y/N token — no tool calls, no streaming.
test("JudgeSessionFactory creates a text-only isolated judge session config", async () => {
  const receivedConfigs = createRecordedConfigs<SessionConfig>();
  const factory = new JudgeSessionFactory({
    clientManager: createSessionRecordingClientManager(receivedConfigs)
  });

  await factory.createSession({
    model: "gpt-5-mini",
    systemMessage: "judge system"
  });

  assert.equal(receivedConfigs.length, 1);

  const config = receivedConfigs[0];
  assert.ok(config);
  assert.deepEqual(config.availableTools, []);
  assert.equal(config.model, "gpt-5-mini");
  assert.equal(config.streaming, false);
  assert.equal(config.onPermissionRequest, approveAll);
  assert.deepEqual(config.systemMessage, {
    mode: "replace",
    content: "judge system"
  });

  assert.equal(config.hooks, undefined);
  assert.equal(config.mcpServers, undefined);
  assert.equal(config.workingDirectory, undefined);
  assert.equal(config.excludedTools, undefined);
});
