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
