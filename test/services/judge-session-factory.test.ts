import assert from "node:assert/strict";
import test from "node:test";
import type { SessionConfig } from "@github/copilot-sdk";

import { JudgeSessionFactory } from "../../src/services/judge-session-factory.ts";
import {
  createRecordedConfigs,
  createSessionRecordingClientManager
} from "../helpers/review-session-runtime-contract-fixture.ts";

// Judge sessions use availableTools:[] (no tools) and streaming:false because
// the judge only needs to emit a single Y/N token — no tool calls, no streaming.
test("JudgeSessionFactory creates a non-streaming isolated judge session with the expected timeout contract", async () => {
  const receivedConfigs = createRecordedConfigs<SessionConfig>();
  const factory = new JudgeSessionFactory({
    clientManager: createSessionRecordingClientManager(receivedConfigs)
  });

  await factory.createSession({
    model: "gpt-5-mini",
    systemMessage: "judge system"
  });

  assert.deepEqual(receivedConfigs, [
    {
      availableTools: [],
      model: "gpt-5-mini",
      onPermissionRequest: receivedConfigs[0].onPermissionRequest,
      streaming: false,
      systemMessage: {
        mode: "replace",
        content: "judge system"
      }
    }
  ]);
});
