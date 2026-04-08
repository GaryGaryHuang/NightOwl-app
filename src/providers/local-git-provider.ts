import { execFileSync } from "node:child_process";
import path from "node:path";

import {
  ReviewSourceProviderError,
  type ReviewSourceProvider
} from "./review-source-provider.ts";

type GitRunner = (args: string[], cwd: string) => string;

function defaultGitRunner(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

/**
 * Local git source adapter backed by the repository's `git` executable.
 */
export class LocalGitProvider implements ReviewSourceProvider {
  readonly #runGit: GitRunner;

  constructor(gitRunner: GitRunner = defaultGitRunner) {
    this.#runGit = gitRunner;
  }

  resolveRepoRoot(startPath: string): string {
    try {
      return this.#runGit(["rev-parse", "--show-toplevel"], path.resolve(startPath));
    } catch (error) {
      throw new ReviewSourceProviderError(
        "resolveRepoRoot",
        "Review source provider failed during resolveRepoRoot.",
        { cause: error }
      );
    }
  }

  getChangedFiles(
    repoRoot: string,
    baseRef: string,
    headRef: string
  ): string[] {
    try {
      const output = this.#runGit(
        ["diff", `${baseRef}...${headRef}`, "--name-only", "--diff-filter=d"],
        repoRoot
      );
      return output ? output.split("\n").filter(Boolean) : [];
    } catch (error) {
      throw new ReviewSourceProviderError(
        "getChangedFiles",
        "Review source provider failed during getChangedFiles.",
        { cause: error }
      );
    }
  }

  getChangesetEntries(
    repoRoot: string,
    baseRef: string,
    headRef: string
  ): string[] {
    // Step 0 needs name-status output so it can see deleted files as part of the full changeset.
    try {
      const output = this.#runGit(
        ["diff", `${baseRef}...${headRef}`, "--name-status"],
        repoRoot
      );
      return output ? output.split("\n").filter(Boolean) : [];
    } catch (error) {
      throw new ReviewSourceProviderError(
        "getChangesetEntries",
        "Review source provider failed during getChangesetEntries.",
        { cause: error }
      );
    }
  }

  getDiff(
    repoRoot: string,
    baseRef: string,
    headRef: string,
    filePath: string
  ): string {
    try {
      return this.#runGit(
        ["diff", `${baseRef}...${headRef}`, "--", filePath],
        repoRoot
      );
    } catch (error) {
      throw new ReviewSourceProviderError(
        "getDiff",
        "Review source provider failed during getDiff.",
        { cause: error }
      );
    }
  }

  getCurrentBranch(repoRoot: string): string | undefined {
    try {
      const branchName = this.#runGit(["branch", "--show-current"], repoRoot);
      return branchName || undefined;
    } catch (error) {
      throw new ReviewSourceProviderError(
        "getCurrentBranch",
        "Review source provider failed during getCurrentBranch.",
        { cause: error }
      );
    }
  }
}
