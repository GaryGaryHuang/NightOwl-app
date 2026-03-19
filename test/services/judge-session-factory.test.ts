import assert from "node:assert/strict";
import test from "node:test";

import { JudgeSessionFactory } from "../../src/services/judge-session-factory.ts";

test("JudgeSessionFactory creates a non-streaming isolated judge session with the expected timeout contract", async () => {
  const receivedConfigs = [];
  const factory = new JudgeSessionFactory({
    clientManager: {
      getClient() {
        return {
          async createSession(config) {
            receivedConfigs.push(config);
            return {
              async sendAndWait() {
                return {
                  data: {
                    content: "Y"
                  }
                };
              },
              async disconnect() {}
            };
          }
        };
      }
    }
  });

  await factory.createSession({
    model: "gpt-5-mini",
    systemMessage: "judge system"
  });

  assert.deepEqual(receivedConfigs, [
    {
      availableTools: [],
      model: "gpt-5-mini",
      streaming: false,
      systemMessage: {
        mode: "replace",
        content: "judge system"
      }
    }
  ]);
});
