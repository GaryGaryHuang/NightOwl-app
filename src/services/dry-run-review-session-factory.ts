import {
  getDryRunStubResponse,
  GENERIC_DRY_RUN_STUB
} from "./dry-run-stub-catalog.ts";
import type {
  ReviewSessionFactoryLike,
  ReviewSessionProfileLike
} from "../core/session-factory-contracts.ts";
import { SessionExecutor } from "./session-executor.ts";

function buildStubSessionExecutor(response: string): SessionExecutor {
  return new SessionExecutor({
    async sendAndWait(_options: { prompt: string }, _timeout?: number) {
      return { data: { content: response } };
    },
    async abort() {},
    async disconnect() {}
  });
}

/**
 * A session factory that returns deterministic stub responses for each review step.
 * Does not start or require a Copilot CLI process.
 *
 * For built-in steps the factory looks up the step's stub response by stepId.
 * For unknown or custom steps a generic dry-run fallback is returned.
 */
export class DryRunReviewSessionFactory implements ReviewSessionFactoryLike {
  async createSession(
    profile: ReviewSessionProfileLike
  ): Promise<SessionExecutor> {
    const response = profile.stepId !== undefined
      ? getDryRunStubResponse(profile.stepId) ?? GENERIC_DRY_RUN_STUB
      : GENERIC_DRY_RUN_STUB;

    return buildStubSessionExecutor(response);
  }
}
