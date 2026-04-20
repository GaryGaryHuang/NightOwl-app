import type { ReviewKnowledgeMode } from "./review-knowledge-mode.ts";

/**
 * Session factory family map (navigation anchor for new contributors).
 *
 * There are four factory implementations across two axes — real/dry-run and
 * review/judge — all returning a `SessionExecutor` (which satisfies
 * `ReviewSessionLike`):
 *
 *   - `services/review-session-factory.ts`         → real review (tools, policy, knowledge, audit)
 *   - `services/judge-session-factory.ts`          → real judge  (no tools, approveAll)
 *   - `services/dry-run-review-session-factory.ts` → stub review (per-step deterministic responses)
 *   - `services/dry-run-judge-session-factory.ts`  → stub judge  (defaults to "Y")
 *
 * Both dry-run factories share `services/dry-run-session-executor.ts` for the
 * stub `SessionLike` plumbing. Real factories intentionally do not share a base
 * class — their setup needs differ enough that a base would leak options.
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

/**
 * The profile passed to a judge session factory when creating a session.
 */
export interface JudgeSessionProfileLike {
  model: string;
  systemMessage: string;
}

/**
 * Factory contract for creating judge sessions.
 * Implemented by both the production JudgeSessionFactory and the DryRunJudgeSessionFactory.
 */
export interface JudgeSessionFactoryLike {
  createSession(profile: JudgeSessionProfileLike): Promise<ReviewSessionLike>;
}
