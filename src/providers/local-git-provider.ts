import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import {
  ReviewSourceProviderError,
  type ReviewChangesetEntry,
  type ReviewChangesetStatus,
  type ReviewSourceProvider
} from "./review-source-provider.ts";
import { wrapBoundaryError } from "./boundary-error-helper.ts";

type GitRunner = (args: string[], cwd: string) => Promise<string>;

const execFileAsync = promisify(execFile);

async function defaultGitRunner(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, encoding: "utf8" });
  return stdout;
}

function trimTrailingLineEndings(output: string): string {
  return output.replace(/[\r\n]+$/u, "");
}

function normalizeGitScalarOutput(output: string): string {
  return trimTrailingLineEndings(output);
}

function normalizeGitLineOutput(output: string): string[] {
  const normalizedOutput = trimTrailingLineEndings(output);
  return normalizedOutput ? normalizedOutput.split(/\r?\n|\r/u).filter(Boolean) : [];
}

function parseReviewChangesetStatus(statusToken: string): {
  status: ReviewChangesetStatus;
  similarityScore?: number;
} {
  const match = /^(A|M|D|R|C|T|U|X|B)(\d+)?$/u.exec(statusToken);

  if (!match) {
    throw new Error(`Unsupported git changeset status token: ${statusToken}`);
  }

  const [, rawStatus, rawSimilarityScore] = match;
  const normalizedStatus = normalizeReviewChangesetStatus(rawStatus);

  if (rawSimilarityScore === undefined) {
    return { status: normalizedStatus };
  }

  if (rawStatus !== "R" && rawStatus !== "C" && rawStatus !== "M") {
    throw new Error(`Unexpected similarity score for git changeset status: ${statusToken}`);
  }

  return { status: normalizedStatus, similarityScore: Number(rawSimilarityScore) };
}

function normalizeReviewChangesetStatus(rawStatus: string): ReviewChangesetStatus {
  switch (rawStatus) {
    case "A":
    case "M":
    case "D":
    case "R":
    case "C":
      return rawStatus;
    case "T":
    case "U":
    case "X":
    case "B":
      // Preserve compatibility with valid Git change kinds that the review
      // pipeline does not model separately by collapsing them into generic
      // file modifications.
      return "M";
    default:
      throw new Error(`Unsupported git changeset status token: ${rawStatus}`);
  }
}

function parseReviewChangesetEntry(line: string): ReviewChangesetEntry {
  const [statusToken, ...paths] = line.split("\t");

  if (!statusToken) {
    throw new Error("Missing git changeset status token.");
  }

  const { status, similarityScore } = parseReviewChangesetStatus(statusToken);

  if (status === "R" || status === "C") {
    const [previousPath, nextPath] = paths;

    if (!previousPath || !nextPath || paths.length !== 2) {
      throw new Error(`Malformed git rename/copy changeset entry: ${line}`);
    }

    return {
      status,
      path: nextPath,
      previousPath,
      ...(similarityScore === undefined ? {} : { similarityScore })
    };
  }

  const [path] = paths;

  if (!path || paths.length !== 1) {
    throw new Error(`Malformed git changeset entry: ${line}`);
  }

  return similarityScore === undefined
    ? { status, path }
    : { status, path, similarityScore };
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
      async () => normalizeGitScalarOutput(
        await this.#runGit(["rev-parse", "--show-toplevel"], path.resolve(startPath))
      ),
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
        return normalizeGitLineOutput(output);
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
  ): Promise<ReviewChangesetEntry[]> {
    // Step 0 needs name-status output so it can see deleted files as part of the full changeset.
    return wrapBoundaryError(
      async () => {
        const output = await this.#runGit(
          ["diff", `${baseRef}...${headRef}`, "--name-status"],
          repoRoot
        );
        return normalizeGitLineOutput(output).map(parseReviewChangesetEntry);
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
        const branchName = normalizeGitScalarOutput(
          await this.#runGit(["branch", "--show-current"], repoRoot)
        );
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
