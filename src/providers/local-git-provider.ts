import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import {
  ReviewSourceProviderError,
  type ReviewSourceProvider
} from "./review-source-provider.ts";
import { wrapBoundaryError } from "./boundary-error-helper.ts";

type GitRunner = (args: string[], cwd: string) => Promise<string>;

const execFileAsync = promisify(execFile);

async function defaultGitRunner(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, encoding: "utf8" });
  return stdout.trim();
}

/**
 * Local git source adapter backed by the repository's `git` executable.
 */
export class LocalGitProvider implements ReviewSourceProvider {
  readonly #runGit: GitRunner;

  constructor(gitRunner: GitRunner = defaultGitRunner) {
    this.#runGit = gitRunner;
  }

  async resolveRepoRoot(startPath: string): Promise<string> {
    return wrapBoundaryError(
      () => this.#runGit(["rev-parse", "--show-toplevel"], path.resolve(startPath)),
      (cause) => new ReviewSourceProviderError(
        "resolveRepoRoot",
        "Review source provider failed during resolveRepoRoot.",
        { cause }
      )
    );
  }

  async getChangedFiles(
    repoRoot: string,
    baseRef: string,
    headRef: string
  ): Promise<string[]> {
    return wrapBoundaryError(
      async () => {
        const output = await this.#runGit(
          ["diff", `${baseRef}...${headRef}`, "--name-only", "--diff-filter=d"],
          repoRoot
        );
        return output ? output.split("\n").filter(Boolean) : [];
      },
      (cause) => new ReviewSourceProviderError(
        "getChangedFiles",
        "Review source provider failed during getChangedFiles.",
        { cause }
      )
    );
  }

  async getChangesetEntries(
    repoRoot: string,
    baseRef: string,
    headRef: string
  ): Promise<string[]> {
    // Step 0 needs name-status output so it can see deleted files as part of the full changeset.
    return wrapBoundaryError(
      async () => {
        const output = await this.#runGit(
          ["diff", `${baseRef}...${headRef}`, "--name-status"],
          repoRoot
        );
        return output ? output.split("\n").filter(Boolean) : [];
      },
      (cause) => new ReviewSourceProviderError(
        "getChangesetEntries",
        "Review source provider failed during getChangesetEntries.",
        { cause }
      )
    );
  }

  async getDiff(
    repoRoot: string,
    baseRef: string,
    headRef: string,
    filePath: string
  ): Promise<string> {
    return wrapBoundaryError(
      () => this.#runGit(
        ["diff", `${baseRef}...${headRef}`, "--", filePath],
        repoRoot
      ),
      (cause) => new ReviewSourceProviderError(
        "getDiff",
        "Review source provider failed during getDiff.",
        { cause }
      )
    );
  }

  async getCurrentBranch(repoRoot: string): Promise<string | undefined> {
    return wrapBoundaryError(
      async () => {
        const branchName = await this.#runGit(["branch", "--show-current"], repoRoot);
        return branchName || undefined;
      },
      (cause) => new ReviewSourceProviderError(
        "getCurrentBranch",
        "Review source provider failed during getCurrentBranch.",
        { cause }
      )
    );
  }
}
