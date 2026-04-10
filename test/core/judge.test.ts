import assert from "node:assert/strict";
import test from "node:test";

import { JudgeService } from "../../src/core/judge.ts";
import type { JudgeSessionProfile } from "../../src/services/judge-session-factory.ts";
import { SessionExecutor } from "../../src/services/session-executor.ts";

type JudgeObservedEvent =
  | ["createSession", JudgeSessionProfile]
  | ["sendAndWait", { prompt: string }, number | undefined]
  | ["disconnect"];

test("JudgeService passes through section content and criteria, and accepts yes-style responses", async () => {
  const observed: JudgeObservedEvent[] = [];
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
        systemMessage: [
          "You are a completion checker. Evaluate whether the content in <section> satisfies the requirements explicitly listed in <criteria>.",
          "",
          "General Rules:",
          "- Check the requirements in <criteria> one by one.",
          "- Judge only against the requirements explicitly stated in <criteria>. Do not add stricter standards of your own.",
          "- Treat a field as valid if it is present and provides a meaningful response to the required item. Concise answers are acceptable if they directly satisfy the requirement.",
          "- If a requirement explicitly allows a negative, none, or not-applicable style answer (e.g., \"無\", \"無外部相依\"), treat that response as valid.",
          "- A field fails only if it is missing, blank, clearly unreplaced placeholder text (e.g., \"[the file's primary role]\"), or does not answer the required item at all.",
          "- Minor formatting variations (e.g., bullet style, heading level, whitespace) do not constitute a failure as long as the required content is present and meaningful.",
          "- Do not use outside knowledge. Judge only from <section> and <criteria>.",
          "- If any requirement is not met or cannot be verified from <section>, output N.",
          "",
          "Output Y only if every requirement is satisfied.",
          "Output N otherwise.",
          "Output only Y or N — no other text or explanation."
        ].join("\n")
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
    const disconnectCalls: string[] = [];
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
            async disconnect() {
              disconnectCalls.push("disconnect");
            }
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
    assert.deepEqual(disconnectCalls, ["disconnect"]);
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
  const disconnectCalls: string[] = [];
  const service = new JudgeService({
    judgeSessionFactory: {
      async createSession() {
        return new SessionExecutor({
          async sendAndWait() {
            throw new Error("judge timeout");
          },
          async disconnect() {
            disconnectCalls.push("disconnect");
          }
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
  assert.deepEqual(disconnectCalls, ["disconnect"]);
});

test("JudgeService phase 1 path does not require session.abort support", async () => {
  const disconnectCalls: string[] = [];
  const service = new JudgeService({
    judgeSessionFactory: {
      async createSession() {
        return new SessionExecutor({
          async sendAndWait() {
            return {
              data: {
                content: "Y"
              }
            };
          },
          async disconnect() {
            disconnectCalls.push("disconnect");
          }
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

  assert.equal(result.passed, true);
  assert.deepEqual(disconnectCalls, ["disconnect"]);
});
