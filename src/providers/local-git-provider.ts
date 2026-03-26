import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import ignore from "ignore";

import type { ReviewSourceProvider } from "./review-source-provider.ts";

/**
 * Local git source adapter backed by the repository's `git` executable.
 */
export class LocalGitProvider implements ReviewSourceProvider {
  resolveRepoRoot(startPath: string): string {
    return runGit(path.resolve(startPath), ["rev-parse", "--show-toplevel"]);
  }

  getChangedFiles(
    repoRoot: string,
    baseRef: string,
    headRef: string
  ): string[] {
    const output = runGit(repoRoot, [
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
    const output = runGit(repoRoot, [
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
    return runGit(repoRoot, ["diff", `${baseRef}...${headRef}`, "--", filePath]);
  }

  getCurrentBranch(repoRoot: string): string | undefined {
    const branchName = runGit(repoRoot, ["branch", "--show-current"]);

    return branchName || undefined;
  }

  filterIgnoredFiles(repoRoot: string, files: string[]): string[] {
    const reviewIgnorePath = path.join(repoRoot, ".reviewignore");

    if (!existsSync(reviewIgnorePath)) {
      return [...files];
    }

    const matcher = ignore().add(readFileSync(reviewIgnorePath, "utf8"));

    // `.reviewignore` follows gitignore-style matching, so normalize separators before evaluation.
    return files.filter((filePath) => !matcher.ignores(normalizeFilePath(filePath)));
  }
}

function normalizeFilePath(filePath: string): string {
  return filePath.replace(/\\/gu, "/");
}

function runGit(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8"
  }).trim();
}
