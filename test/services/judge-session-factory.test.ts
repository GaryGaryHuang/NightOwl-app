import assert from "node:assert/strict";
import test from "node:test";
import type { SessionConfig } from "@github/copilot-sdk";

import { JudgeSessionFactory } from "../../src/services/judge-session-factory.ts";
import {
  createRecordedConfigs,
  createSessionRecordingClientManager
} from "../helpers/review-session-runtime-contract-fixture.ts";

async function createJudgeSessionConfig(): Promise<SessionConfig> {
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

  return config;
}

test("JudgeSessionFactory passes the judge profile into a replacement system message", async () => {
  const config = await createJudgeSessionConfig();

  assert.equal(config.model, "gpt-5-mini");
  assert.deepEqual(config.systemMessage, {
    mode: "replace",
    content: "judge system"
  });
});

// Judge sessions are isolated from review-session tool/context surfaces because
// the judge only needs to emit a single Y/N token.
test("JudgeSessionFactory creates an isolated text-only judge session", async () => {
  const config = await createJudgeSessionConfig();

  assert.deepEqual(config.availableTools, []);
  assert.equal(config.streaming, false);
  assert.equal(config.hooks, undefined);
  assert.equal(config.mcpServers, undefined);
  assert.equal(config.workingDirectory, undefined);
});
