import assert from "node:assert/strict";
import test from "node:test";

import { JudgeService } from "../../src/core/judge.ts";
import type { JudgeSessionProfile } from "../../src/services/judge-session-factory.ts";
import { SessionExecutor } from "../../src/services/session-executor.ts";

type JudgeObservedEvent =
  | ["createSession", JudgeSessionProfile]
  | ["sendAndWait", { prompt: string }, number | undefined]
  | ["disconnect"];

const DEFAULT_EVALUATION_INPUT = {
  stepId: "step1-overview",
  filePath: "src/app.ts",
  criteria: "段落 `## Overview` 必須存在",
  sectionContent: "## Overview\n- 整體理解：測試"
};

test("JudgeService passes section content and criteria into a minimal judge session", async () => {
  const { observed, service } = createRecordingJudgeService({
    response: " Yes "
  });

  const result = await service.evaluate(DEFAULT_EVALUATION_INPUT);

  assert.equal(result.passed, true);
  assert.equal(observed.length, 3);
  assert.deepEqual(observed[0], [
    "createSession",
    {
      model: "gpt-5-mini",
      systemMessage: assertJudgeSystemMessageContract(
        (observed[0]?.[1] as JudgeSessionProfile | undefined)?.systemMessage
      )
    }
  ]);
  assert.deepEqual(observed[1], [
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
  ]);
  assert.deepEqual(observed[2], ["disconnect"]);
});

test("JudgeService accepts only yes-style responses", async () => {
  const passingResponses = ["Y", " Yes "];
  const rejectedResponses = ["N", "   ", "maybe"];

  for (const response of passingResponses) {
    const { service } = createRecordingJudgeService({ response });

    assert.deepEqual(
      await service.evaluate(DEFAULT_EVALUATION_INPUT),
      { passed: true }
    );
  }

  for (const response of rejectedResponses) {
    const { service, observed } = createRecordingJudgeService({ response });

    assert.deepEqual(
      await service.evaluate(DEFAULT_EVALUATION_INPUT),
      { passed: false, cause: "judge rejected" }
    );
    assert.deepEqual(observed.at(-1), ["disconnect"]);
  }
});

test("JudgeService reports stable judge startup failures", async () => {
  const service = new JudgeService({
    judgeSessionFactory: {
      async createSession() {
        throw new Error("underlying startup failure");
      }
    }
  });

  await assert.rejects(
    () => service.evaluate(DEFAULT_EVALUATION_INPUT),
    /judge startup failed/u
  );
});

test("JudgeService reports stable judge turn failures and disconnects", async () => {
  const { observed, service } = createRecordingJudgeService({
    sendError: new Error("underlying timeout")
  });

  await assert.rejects(
    () => service.evaluate(DEFAULT_EVALUATION_INPUT),
    /judge timeout/u
  );
  assert.deepEqual(observed.at(-1), ["disconnect"]);
});

test("JudgeService does not require judge sessions to expose abort", async () => {
  const { observed, service } = createRecordingJudgeService({
    response: "Y"
  });

  assert.deepEqual(
    await service.evaluate(DEFAULT_EVALUATION_INPUT),
    { passed: true }
  );
  assert.deepEqual(observed.at(-1), ["disconnect"]);
});

function createRecordingJudgeService(input: {
  response?: string;
  sendError?: Error;
}): { observed: JudgeObservedEvent[]; service: JudgeService } {
  const observed: JudgeObservedEvent[] = [];
  const service = new JudgeService({
    judgeSessionFactory: {
      async createSession(profile) {
        observed.push(["createSession", profile]);

        return new SessionExecutor({
          async sendAndWait(options, timeoutMs) {
            observed.push(["sendAndWait", options, timeoutMs]);

            if (input.sendError) {
              throw input.sendError;
            }

            return {
              data: {
                content: input.response ?? "Y"
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

  return { observed, service };
}

function assertJudgeSystemMessageContract(systemMessage: unknown): string {
  if (typeof systemMessage !== "string") {
    throw new Error("expected judge system message to be a string");
  }

  assert.match(
    systemMessage,
    /completion checker.*<section>.*<criteria>/u
  );
  assert.match(
    systemMessage,
    /Judge only against the requirements explicitly stated in <criteria>/u
  );
  assert.match(systemMessage, /Do not use outside knowledge/u);
  assert.match(systemMessage, /Output only Y or N/u);

  return systemMessage;
}
