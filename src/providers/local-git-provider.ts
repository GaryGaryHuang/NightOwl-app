import { execFileSync } from "node:child_process";
import path from "node:path";

import {
  ReviewSourceProviderError,
  type ReviewSourceProvider,
  type ReviewSourceProviderOperation
} from "./review-source-provider.ts";

/**
 * Local git source adapter backed by the repository's `git` executable.
 */
export class LocalGitProvider implements ReviewSourceProvider {
  resolveRepoRoot(startPath: string): string {
    return runGit("resolveRepoRoot", path.resolve(startPath), [
      "rev-parse",
      "--show-toplevel"
    ]);
  }

  getChangedFiles(
    repoRoot: string,
    baseRef: string,
    headRef: string
  ): string[] {
    const output = runGit("getChangedFiles", repoRoot, [
      "diff",
      `${baseRef}...${headRef}`,
      "--name-only",
      "--diff-filter=d"
    ]);

    return output ? output.split("\n").filter(Boolean) : [];
  }

  getChangesetEntries(
    repoRoot: string,
    baseRef: string,
    headRef: string
  ): string[] {
    // Step 0 needs name-status output so it can see deleted files as part of the full changeset.
    const output = runGit("getChangesetEntries", repoRoot, [
      "diff",
      `${baseRef}...${headRef}`,
      "--name-status"
    ]);

    return output ? output.split("\n").filter(Boolean) : [];
  }

  getDiff(
    repoRoot: string,
    baseRef: string,
    headRef: string,
    filePath: string
  ): string {
    return runGit("getDiff", repoRoot, [
      "diff",
      `${baseRef}...${headRef}`,
      "--",
      filePath
    ]);
  }

  getCurrentBranch(repoRoot: string): string | undefined {
    const branchName = runGit("getCurrentBranch", repoRoot, [
      "branch",
      "--show-current"
    ]);

    return branchName || undefined;
  }
}

function runGit(
  operation: ReviewSourceProviderOperation,
  cwd: string,
  args: string[]
): string {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8"
    }).trim();
  } catch (error) {
    throw new ReviewSourceProviderError(
      operation,
      `Review source provider failed during ${operation}.`,
      { cause: error }
    );
  }
}
