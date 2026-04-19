import {
  buildDryRunChangesetOverviewResponse,
  getDryRunStubResponse,
  GENERIC_DRY_RUN_STUB
} from "./dry-run-stub-catalog.ts";
import type {
  ReviewSessionFactoryLike,
  ReviewSessionProfileLike
} from "../core/session-factory-contracts.ts";
import { SessionExecutor } from "./session-executor.ts";

function buildStubSessionExecutor(
  responseProvider: (prompt: string) => string
): SessionExecutor {
  return new SessionExecutor({
    async sendAndWait(options: { prompt: string }, _timeout?: number) {
      return { data: { content: responseProvider(options.prompt) } };
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
    if (profile.stepId === "changeset-overview") {
      // Step 0 must produce a structurally-valid ChangeMap whose changedFiles[]
      // exactly matches the run's actual changed paths, so we derive the JSON
      // from the prompt's <changed_files> block at send time.
      return buildStubSessionExecutor(buildDryRunChangesetOverviewResponse);
    }

    const response = profile.stepId !== undefined
      ? getDryRunStubResponse(profile.stepId) ?? GENERIC_DRY_RUN_STUB
      : GENERIC_DRY_RUN_STUB;

    return buildStubSessionExecutor(() => response);
  }
}
