import { SessionExecutor } from "./session-executor.ts";

/**
 * Build a single-use {@link SessionExecutor} backed by a stub `SessionLike`
 * that never touches the Copilot SDK.
 *
 * The dry-run review session factory delegates here so the stub `SessionLike`
 * shape is isolated to one call site.
 *
 * The `responseProvider` receives the prompt that the step sent and returns the
 * deterministic content to surface as the session response.
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
