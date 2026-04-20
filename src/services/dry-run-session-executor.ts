import { SessionExecutor } from "./session-executor.ts";

/**
 * Build a single-use {@link SessionExecutor} backed by a stub `SessionLike`
 * that never touches the Copilot SDK.
 *
 * Both {@link import("./dry-run-review-session-factory.ts").DryRunReviewSessionFactory}
 * and {@link import("./dry-run-judge-session-factory.ts").DryRunJudgeSessionFactory}
 * delegate here so that all dry-run sessions share one construction seam:
 * if the stub session shape ever changes, this is the only call site to update.
 *
 * The `responseProvider` receives the prompt that the step (or judge) sent and
 * returns the deterministic content to surface as the session response.
 */
export function buildStubSessionExecutor(
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
