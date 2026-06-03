import type { ReviewKnowledgeMode } from "./review-knowledge-mode.ts";

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
 *
 * `repoRoot` is the active Agent read boundary. Snapshot-backed local reviews
 * set it to the detached source snapshot. `reviewOutputRoot` identifies the
 * host output metadata location for the original repository; it must not expand
 * Agent read access.
 */
export interface ReviewSessionProfileLike {
  stepId?: string;
  knowledgeMode: ReviewKnowledgeMode;
  model: string;
  repoRoot: string;
  reviewOutputRoot?: string;
  sourceBaseRef?: string;
  sourceHeadRef?: string;
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
