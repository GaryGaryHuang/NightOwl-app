import assert from "node:assert/strict";
import test from "node:test";

import { JudgeService } from "../../src/core/judge.ts";
import { SessionExecutor } from "../../src/services/session-executor.ts";

test("JudgeService passes through section content and criteria, and accepts yes-style responses", async () => {
  const observed = [];
  const service = new JudgeService({
    judgeSessionFactory: {
      async createSession(profile) {
        observed.push(["createSession", profile]);

        return new SessionExecutor({
          async sendAndWait(options, timeoutMs) {
            observed.push(["sendAndWait", options, timeoutMs]);

            return {
              data: {
                content: " Yes "
              }
            };
          },
          async disconnect() {
            observed.push(["disconnect"]);
          }
        });
      }
    }
  });

  const result = await service.evaluate({
    stepId: "step1-overview",
    filePath: "src/app.ts",
    criteria: "段落 `## Overview` 必須存在",
    sectionContent: "## Overview\n- 整體理解：測試"
  });

  assert.equal(result.passed, true);
  assert.deepEqual(observed, [
    [
      "createSession",
      {
        model: "gpt-5-mini",
        systemMessage: service.systemMessage,
        timeoutMs: 180_000
      }
    ],
    [
      "sendAndWait",
      {
        prompt: [
          "Evaluate whether <section> satisfies all requirements in <criteria>.",
          "Return `Y` if all requirements are satisfied.",
          "Return `N` otherwise.",
          "",
          "<section>",
          "## Overview",
          "- 整體理解：測試",
          "</section>",
          "",
          "<criteria>",
          "段落 `## Overview` 必須存在",
          "</criteria>"
        ].join("\n")
      },
      180_000
    ],
    ["disconnect"]
  ]);
});

test("JudgeService rejects all non-yes responses", async () => {
  const responses = ["N", "   ", "maybe"];

  for (const response of responses) {
    const service = new JudgeService({
      judgeSessionFactory: {
        async createSession() {
          return new SessionExecutor({
            async sendAndWait() {
              return {
                data: {
                  content: response
                }
              };
            },
            async disconnect() {}
          });
        }
      }
    });

    const result = await service.evaluate({
      stepId: "step1-overview",
      filePath: "src/app.ts",
      criteria: "criteria",
      sectionContent: "section"
    });

    assert.equal(result.passed, false);
    assert.equal(result.cause, "judge rejected");
  }
});

test("JudgeService wraps judge startup failure with step and file context", async () => {
  const service = new JudgeService({
    judgeSessionFactory: {
      async createSession() {
        throw new Error("judge startup failed");
      }
    }
  });

  await assert.rejects(
    () =>
      service.evaluate({
        stepId: "step1-overview",
        filePath: "src/app.ts",
        criteria: "criteria",
        sectionContent: "section"
      }),
    /judge startup failed/u
  );
});

test("JudgeService wraps judge timeout failure with step and file context", async () => {
  const service = new JudgeService({
    judgeSessionFactory: {
      async createSession() {
        return new SessionExecutor({
          async sendAndWait() {
            throw new Error("judge timeout");
          },
          async disconnect() {}
        });
      }
    }
  });

  await assert.rejects(
    () =>
      service.evaluate({
        stepId: "step1-overview",
        filePath: "src/app.ts",
        criteria: "criteria",
        sectionContent: "section"
      }),
    /judge timeout/u
  );
});
