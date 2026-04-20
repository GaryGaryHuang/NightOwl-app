import {
  getDryRunResponseProvider
} from "./dry-run-stub-catalog.ts";
import type {
  ReviewSessionFactoryLike,
  ReviewSessionProfileLike
} from "../core/session-factory-contracts.ts";
import { buildStubSessionExecutor } from "./dry-run-session-executor.ts";
import { SessionExecutor } from "./session-executor.ts";

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
    return buildStubSessionExecutor(getDryRunResponseProvider(profile.stepId));
  }
}
