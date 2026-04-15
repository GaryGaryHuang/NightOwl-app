import path from "node:path";

import { isAllowedReviewReadPath } from "../../core/review-access-guard.ts";

import type { ReviewSessionProfile } from "../review-session-factory.ts";
import {
  containsTopLevelRedirection,
  splitTopLevelChainSegments,
  splitTopLevelPipelineSegments
} from "./shell-command-parser.ts";
import type { ToolPolicyDecisionDeny, ToolPolicyDecision } from "./tool-policy-types.ts";

export type { ToolPolicyDecisionDeny, ToolPolicyDecision } from "./tool-policy-types.ts";

export const READONLY_BASH_DENY_REASON =
  "Review sessions only allow repo-local read-only shell analysis commands.";

const ALLOWED_BASH_PREFIXES = [
  "git diff",
  "git show",
  "git log",
  "git status",
  "git rev-parse",
  "git merge-base",
  "git rev-list",
  "git ls-files",
  "git blame",
  "git grep",
  "git cat-file",
  "cat",
  "ls",
  "head",
  "tail",
  "find",
  "rg",
  "grep",
  "sed -n",
  "cut",
  "sort",
  "uniq",
  "wc",
  "cd",
  "nl",
  "file",
  "stat",
  "tree",
  "realpath",
  "basename",
  "dirname",
  "diff",
  "awk"
];

const DANGEROUS_BASH_FLAGS = new Set(["-o", "--output", "-exec", "-execdir"]);

export function evaluateReadonlyShellCommand(
  command: string,
  profile: Pick<ReviewSessionProfile, "repoRoot">,
  commandCwd?: string
): ToolPolicyDecision {
  return isAllowedReadonlyBashCommand(command, profile, commandCwd)
    ? undefined
    : {
        permissionDecision: "deny",
        permissionDecisionReason: READONLY_BASH_DENY_REASON
      };
}

function isAllowedReadonlyBashCommand(
  command: string,
  profile: Pick<ReviewSessionProfile, "repoRoot">,
  commandCwd?: string
): boolean {
  const trimmedCommand = command.trim();

  if (!trimmedCommand) {
    return false;
  }

  if (/[;`]/u.test(trimmedCommand) || /\$\(/u.test(trimmedCommand)) {
    return false;
  }

  const hasTopLevelRedirection = containsTopLevelRedirection(trimmedCommand);

  if (hasTopLevelRedirection !== false) {
    return false;
  }

  if (trimmedCommand.includes("||")) {
    return false;
  }

  const chainSegments = splitTopLevelChainSegments(trimmedCommand);

  if (!chainSegments) {
    return false;
  }

  let effectiveCwd = commandCwd;

  for (const chainSegment of chainSegments) {
    const pipelineSegments = splitTopLevelPipelineSegments(chainSegment);

    if (!pipelineSegments) {
      return false;
    }

    if (
      !pipelineSegments.every((segment) =>
        isAllowedSingleSegment(segment, profile, effectiveCwd)
      )
    ) {
      return false;
    }

    const cdCwd = extractCdCwd(chainSegment, profile, effectiveCwd);

    if (cdCwd === false) {
      return false;
    }

    if (cdCwd !== undefined) {
      effectiveCwd = cdCwd;
    }
  }

  return true;
}

/**
 * If the chain segment is a `cd <path>` command, extract and validate the path.
 * Returns the resolved cwd string on success, `undefined` if not a cd command,
 * or `false` if it's a cd command that should deny.
 */
function extractCdCwd(
  chainSegment: string,
  profile: Pick<ReviewSessionProfile, "repoRoot">,
  effectiveCwd?: string
): string | false | undefined {
  const trimmed = chainSegment.trim();

  if (trimmed !== "cd" && !trimmed.startsWith("cd ")) {
    return undefined;
  }

  const tokens = trimmed.split(/\s+/u).filter(Boolean);
  const pathToken = tokens.slice(1).find((token) => !token.startsWith("-"));

  if (!pathToken) {
    return false;
  }

  const baseDirectory =
    typeof effectiveCwd === "string" && effectiveCwd.trim()
      ? effectiveCwd
      : profile.repoRoot;

  const resolvedPath = resolvePathToken(pathToken, baseDirectory);

  if (!isAllowedReviewReadPath(resolvedPath, profile.repoRoot)) {
    return false;
  }

  return resolvedPath;
}

function isAllowedSingleSegment(
  segment: string,
  profile: Pick<ReviewSessionProfile, "repoRoot">,
  commandCwd?: string
): boolean {
  const trimmed = segment.trim();

  if (!trimmed) {
    return false;
  }

  const normalizedSegment = normalizeGitChangeDirectorySegment(
    trimmed,
    profile,
    commandCwd
  );

  if (!normalizedSegment) {
    return false;
  }

  if (
    !ALLOWED_BASH_PREFIXES.some((prefix) =>
      matchesAllowedBashPrefix(normalizedSegment.command, prefix)
    )
  ) {
    return false;
  }

  if (containsDangerousFlag(normalizedSegment.command)) {
    return false;
  }

  return hasOnlyAllowedPathArguments(
    normalizedSegment.command,
    profile,
    normalizedSegment.baseDirectory
  );
}

function normalizeGitChangeDirectorySegment(
  command: string,
  profile: Pick<ReviewSessionProfile, "repoRoot">,
  commandCwd?: string
): { command: string; baseDirectory?: string } | undefined {
  const tokens = command.split(/\s+/u).filter(Boolean);

  if (tokens[0] !== "git" || tokens[1] !== "-C") {
    return {
      command,
      baseDirectory: commandCwd
    };
  }

  if (tokens.length < 4) {
    return undefined;
  }

  const pathToken = tokens[2];

  if (!path.isAbsolute(pathToken)) {
    return undefined;
  }

  const baseDirectory =
    typeof commandCwd === "string" && commandCwd.trim()
      ? commandCwd
      : profile.repoRoot;
  const resolvedPath = resolvePathToken(pathToken, baseDirectory);

  if (!isAllowedReviewReadPath(resolvedPath, profile.repoRoot)) {
    return undefined;
  }

  return {
    command: `git ${tokens.slice(3).join(" ")}`,
    baseDirectory: resolvedPath
  };
}

function matchesAllowedBashPrefix(command: string, prefix: string): boolean {
  return command === prefix || command.startsWith(`${prefix} `);
}

function hasOnlyAllowedPathArguments(
  command: string,
  profile: Pick<ReviewSessionProfile, "repoRoot">,
  commandCwd?: string
): boolean {
  const tokens = command.split(/\s+/u).filter(Boolean);
  const baseDirectory =
    typeof commandCwd === "string" && commandCwd.trim()
      ? commandCwd
      : profile.repoRoot;

  for (const token of tokens.slice(1)) {
    if (token === "--") {
      continue;
    }

    if (token.startsWith("-")) {
      continue;
    }

    // Plain names (no path separator) are intentionally not path-checked here.
    // Their safety relies on the invariant that `baseDirectory` is always either
    // `repoRoot` or a path previously validated by `extractCdCwd` — so any bare
    // name resolves within the already-verified boundary.
    if (
      looksLikePath(token) &&
      !isAllowedReviewReadPath(resolvePathToken(token, baseDirectory), profile.repoRoot)
    ) {
      return false;
    }
  }

  return true;
}

function looksLikePath(token: string): boolean {
  return (
    token.startsWith("/") ||
    token.startsWith("~") ||
    token.startsWith("./") ||
    token.startsWith("../") ||
    token.includes("/")
  );
}

function resolvePathToken(token: string, baseDirectory: string): string {
  if (token === "~") {
    return process.env.HOME ?? token;
  }

  if (token.startsWith("~/")) {
    return path.join(process.env.HOME ?? "", token.slice(2));
  }

  if (path.isAbsolute(token)) {
    return token;
  }

  return path.resolve(baseDirectory, token);
}

function containsDangerousFlag(command: string): boolean {
  const tokens = command.split(/\s+/u).filter(Boolean);

  return tokens.some(
    (token) => DANGEROUS_BASH_FLAGS.has(token) || token.startsWith("--output=")
  );
}
