import type {
  JudgeSessionFactoryLike,
  JudgeSessionProfileLike
} from "../core/session-factory-contracts.ts";
import { buildStubSessionExecutor } from "./dry-run-session-executor.ts";
import { SessionExecutor } from "./session-executor.ts";

export interface DryRunJudgeSessionFactoryOptions {
  /**
   * Optional override for the verdict returned by the stub judge session.
   * Receives the prompt and the judge profile. Defaults to always returning
   * "Y" so existing callers continue to see unconditional approval.
   */
  readonly responseProvider?: (
    prompt: string,
    profile: JudgeSessionProfileLike
  ) => string;
}

const ALWAYS_APPROVE: NonNullable<
  DryRunJudgeSessionFactoryOptions["responseProvider"]
> = () => "Y";

/**
 * A judge session factory that always approves (returns "Y") by default.
 * Used in dry-run mode to let all steps pass completion checks. Pass a custom
 * `responseProvider` to simulate denials or other verdicts in tests without
 * touching production callers.
 */
export class DryRunJudgeSessionFactory implements JudgeSessionFactoryLike {
  readonly #responseProvider: NonNullable<
    DryRunJudgeSessionFactoryOptions["responseProvider"]
  >;

  constructor(options: DryRunJudgeSessionFactoryOptions = {}) {
    this.#responseProvider = options.responseProvider ?? ALWAYS_APPROVE;
  }

  async createSession(
    profile: JudgeSessionProfileLike
  ): Promise<SessionExecutor> {
    return buildStubSessionExecutor((prompt) =>
      this.#responseProvider(prompt, profile)
    );
  }
}
