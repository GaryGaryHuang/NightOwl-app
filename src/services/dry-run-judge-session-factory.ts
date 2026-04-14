import type { JudgeSessionProfile } from "./judge-session-factory.ts";
import { SessionExecutor } from "./session-executor.ts";

/**
 * A judge session factory that always approves (returns "Y").
 * Used in dry-run mode to let all steps pass completion checks.
 */
export class DryRunJudgeSessionFactory {
  async createSession(
    _profile: JudgeSessionProfile
  ): Promise<SessionExecutor> {
    return new SessionExecutor({
      async sendAndWait(_options: { prompt: string }, _timeout?: number) {
        return { data: { content: "Y" } };
      },
      async abort() {},
      async disconnect() {}
    });
  }
}
