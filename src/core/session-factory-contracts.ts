import type { ReviewKnowledgeMode } from "./review-knowledge-mode.ts";

/**
 * Session factory family map (navigation anchor for new contributors).
 *
 * There are two review factory implementations across real and dry-run modes,
 * both returning a `SessionExecutor` (which satisfies `ReviewSessionLike`):
 *
 *   - `services/review-session-factory.ts`         → real review (tools, policy, knowledge, audit)
 *   - `services/dry-run-review-session-factory.ts` → stub review (per-step deterministic responses)
 *
 * The dry-run factory owns the stub `SessionLike` plumbing directly. The real
 * factory owns SDK session setup directly.
 */

/**
 * The session object returned by a review session factory.
 */
export interface ReviewSessionLike {
  sendAndWait(
    prompt: string,
    timeoutMs?: number,
    signal?: AbortSignal
  ): Promise<string | undefined>;
}

/**
 * The profile passed to a review session factory when creating a session.
 */
export interface ReviewSessionProfileLike {
  stepId?: string;
  knowledgeMode: ReviewKnowledgeMode;
  model: string;
  outputBaseDir: string;
  repoRoot: string;
  systemMessage: string;
  workingDirectory?: string;
}

/**
 * Factory contract for creating review sessions.
 * Implemented by both the production ReviewSessionFactory and the DryRunReviewSessionFactory.
 */
export interface ReviewSessionFactoryLike {
  createSession(profile: ReviewSessionProfileLike): Promise<ReviewSessionLike>;
}
