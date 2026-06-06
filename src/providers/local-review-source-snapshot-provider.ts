import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { wrapBoundaryError } from "./boundary-error-helper.ts";

export type ReviewSourceSnapshotProviderOperation =
  | "resolveRef"
  | "dirtyCheck"
  | "createWorktree"
  | "cleanup";

export class ReviewSourceSnapshotProviderError extends Error {
  readonly operation: ReviewSourceSnapshotProviderOperation;

  constructor(
    operation: ReviewSourceSnapshotProviderOperation,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = "ReviewSourceSnapshotProviderError";
    this.operation = operation;
  }
}

export interface CreateReviewSourceSnapshotInput {
  repoRoot: string;
  baseRef: string;
  headRef: string;
}

export interface ReviewSourceSnapshot {
  readonly originalRepoRoot: string;
  readonly reviewSourceRoot: string;
  readonly resolvedBaseRef: string;
  readonly resolvedHeadRef: string;
  readonly isDirty: boolean;
  cleanup(): Promise<void>;
}

export interface ReviewSourceSnapshotProvider {
  createSnapshot(
    input: CreateReviewSourceSnapshotInput
  ): Promise<ReviewSourceSnapshot>;
}

export interface SnapshotGitRunnerOptions {
  env?: NodeJS.ProcessEnv;
}

export type SnapshotGitRunner = (
  args: string[],
  cwd: string,
  options?: SnapshotGitRunnerOptions
) => Promise<string>;

export interface LocalReviewSourceSnapshotProviderOptions {
  createSnapshotDirectory?: () => Promise<string>;
  gitRunner?: SnapshotGitRunner;
}

const execFileAsync = promisify(execFile);

async function defaultGitRunner(
  args: string[],
  cwd: string,
  options?: SnapshotGitRunnerOptions
): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      ...options?.env
    }
  });
  return stdout;
}

// Returns a short, not-yet-existing path; `git worktree add` creates the
// directory, so this must not pre-create it. The name is kept deliberately short
// (one random token, no pid/full UUID) to reduce downstream path-handling errors.
// The `nightowl-` marker is retained so orphaned worktrees stay identifiable for
// debugging and manual cleanup (`rm -rf $TMPDIR/nightowl-*`).
async function defaultCreateSnapshotDirectory(): Promise<string> {
  return path.join(tmpdir(), `nightowl-${randomUUID().slice(0, 8)}`);
}

function trimTrailingLineEndings(output: string): string {
  return output.replace(/[\r\n]+$/u, "");
}

/**
 * Creates a run-scoped detached worktree pinned to the resolved head commit.
 */
export class LocalReviewSourceSnapshotProvider
implements ReviewSourceSnapshotProvider {
  readonly #createSnapshotDirectory: () => Promise<string>;
  readonly #runGit: SnapshotGitRunner;

  constructor(options: LocalReviewSourceSnapshotProviderOptions = {}) {
    this.#createSnapshotDirectory =
      options.createSnapshotDirectory ?? defaultCreateSnapshotDirectory;
    this.#runGit = options.gitRunner ?? defaultGitRunner;
  }

  async createSnapshot(
    input: CreateReviewSourceSnapshotInput
  ): Promise<ReviewSourceSnapshot> {
    const originalRepoRoot = path.resolve(input.repoRoot);
    const resolvedBaseRef = await this.#resolveRef(
      originalRepoRoot,
      input.baseRef
    );
    const resolvedHeadRef = await this.#resolveRef(
      originalRepoRoot,
      input.headRef
    );
    const isDirty = await this.#isDirty(originalRepoRoot);
    const reviewSourceRoot = path.resolve(await this.#createSnapshotDirectory());

    await this.#createWorktree({
      originalRepoRoot,
      reviewSourceRoot,
      resolvedHeadRef
    });

    return {
      originalRepoRoot,
      reviewSourceRoot,
      resolvedBaseRef,
      resolvedHeadRef,
      isDirty,
      cleanup: () => this.#cleanupWorktree(originalRepoRoot, reviewSourceRoot)
    };
  }

  async #resolveRef(repoRoot: string, ref: string): Promise<string> {
    return wrapBoundaryError(
      async () =>
        trimTrailingLineEndings(
          await this.#runGit(["rev-parse", "--verify", `${ref}^{commit}`], repoRoot)
        ),
      (cause) =>
        new ReviewSourceSnapshotProviderError(
          "resolveRef",
          `Review source snapshot failed to resolve ref '${ref}'.`,
          { cause }
        )
    );
  }

  async #isDirty(repoRoot: string): Promise<boolean> {
    return wrapBoundaryError(
      async () =>
        trimTrailingLineEndings(
          await this.#runGit(["status", "--porcelain=v1"], repoRoot)
        ).length > 0,
      (cause) =>
        new ReviewSourceSnapshotProviderError(
          "dirtyCheck",
          "Review source snapshot failed to inspect working tree status.",
          { cause }
        )
    );
  }

  async #createWorktree(input: {
    originalRepoRoot: string;
    reviewSourceRoot: string;
    resolvedHeadRef: string;
  }): Promise<void> {
    return wrapBoundaryError(
      async () => {
        try {
          await this.#runGit(
            [
              "worktree",
              "add",
              "--detach",
              input.reviewSourceRoot,
              input.resolvedHeadRef
            ],
            input.originalRepoRoot,
            {
              env: {
                GIT_LFS_SKIP_SMUDGE: "1"
              }
            }
          );
        } catch (error) {
          await this.#tryCleanupWorktree(
            input.originalRepoRoot,
            input.reviewSourceRoot
          );
          throw error;
        }
      },
      (cause) =>
        new ReviewSourceSnapshotProviderError(
          "createWorktree",
          "Review source snapshot failed to create detached worktree.",
          { cause }
        )
    );
  }

  async #cleanupWorktree(
    originalRepoRoot: string,
    reviewSourceRoot: string
  ): Promise<void> {
    return wrapBoundaryError(
      async () => {
        await this.#runGit(
          ["worktree", "remove", "--force", reviewSourceRoot],
          originalRepoRoot
        );
      },
      (cause) =>
        new ReviewSourceSnapshotProviderError(
          "cleanup",
          "Review source snapshot failed to remove detached worktree.",
          { cause }
        )
    );
  }

  async #tryCleanupWorktree(
    originalRepoRoot: string,
    reviewSourceRoot: string
  ): Promise<void> {
    try {
      await this.#cleanupWorktree(originalRepoRoot, reviewSourceRoot);
    } catch {
      // Preserve the original create-worktree failure; run-level cleanup
      // failures are handled by the app where the primary outcome is known.
    }
  }
}
