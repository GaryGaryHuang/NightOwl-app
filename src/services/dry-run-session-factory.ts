import {
  getDryRunStubResponse
} from "./dry-run-stub-catalog.ts";
import {
  isDryRunReviewStepContract,
  type DryRunReviewStepContract
} from "./dry-run-review-step-contract.ts";
import type { ReviewSessionProfile } from "./review-session-factory.ts";
import type { JudgeSessionProfile } from "./judge-session-factory.ts";
import { SessionExecutor } from "./session-executor.ts";

export interface DryRunReviewSessionProfile extends ReviewSessionProfile {
  dryRunStepContract: DryRunReviewStepContract;
}

function buildStubSessionExecutor(response: string): SessionExecutor {
  return new SessionExecutor({
    async sendAndWait(_options: { prompt: string }, _timeout?: number) {
      return { data: { content: response } };
    },
    async disconnect() {}
  });
}

// ---------------------------------------------------------------------------
// DryRunReviewSessionFactory
// ---------------------------------------------------------------------------

/**
 * A session factory that returns deterministic stub responses for each review step.
 * Does not start or require a Copilot CLI process.
 */
export class DryRunReviewSessionFactory {
  async createSession(
    profile: DryRunReviewSessionProfile
  ): Promise<SessionExecutor> {
    const contract = profile.dryRunStepContract;

    if (!contract) {
      throw new Error("dry-run contract failure: missing dryRunStepContract");
    }

    if (!isDryRunReviewStepContract(contract)) {
      throw new Error(
        `dry-run contract failure: unsupported dryRunStepContract '${contract}'`
      );
    }

    return buildStubSessionExecutor(getDryRunStubResponse(contract));
  }
}

// ---------------------------------------------------------------------------
// DryRunJudgeSessionFactory
// ---------------------------------------------------------------------------

/**
 * A judge session factory that always approves (returns "Y").
 * Used in dry-run mode to let all steps pass completion checks.
 */
export class DryRunJudgeSessionFactory {
  async createSession(
    _profile: JudgeSessionProfile
  ): Promise<SessionExecutor> {
    return buildStubSessionExecutor("Y");
  }
}
