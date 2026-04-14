import type {
  JudgeSessionFactoryLike,
  JudgeSessionProfileLike
} from "../core/session-factory-contracts.ts";
import { SessionExecutor } from "./session-executor.ts";

/**
 * A judge session factory that always approves (returns "Y").
 * Used in dry-run mode to let all steps pass completion checks.
 */
export class DryRunJudgeSessionFactory implements JudgeSessionFactoryLike {
  async createSession(
    _profile: JudgeSessionProfileLike
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
