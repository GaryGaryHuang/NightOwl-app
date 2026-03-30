import path from "node:path";

import type { ReviewSessionProfile } from "./review-session-factory.ts";

export interface ToolPolicyDecisionDeny {
  permissionDecision: "deny";
  permissionDecisionReason: string;
}

export type ToolPolicyDecision = ToolPolicyDecisionDeny | undefined;

export const READONLY_BASH_DENY_REASON =
  "Review sessions only allow repo-local read-only bash analysis commands.";

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
  "wc -l"
];

const DANGEROUS_BASH_FLAGS = new Set(["-o", "--output"]);

export function evaluateReadonlyShellCommand(
  command: string,
  profile: Pick<ReviewSessionProfile, "repoRoot" | "outputBaseDir">,
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
  profile: Pick<ReviewSessionProfile, "repoRoot" | "outputBaseDir">,
  commandCwd?: string
): boolean {
  const trimmedCommand = command.trim();

  if (!trimmedCommand) {
    return false;
  }

  if (/[;&`><]/u.test(trimmedCommand) || /\$\(/u.test(trimmedCommand)) {
    return false;
  }

  if (trimmedCommand.includes("||")) {
    return false;
  }

  const segments = splitTopLevelPipelineSegments(trimmedCommand);

  if (!segments) {
    return false;
  }

  return segments.every((segment) =>
    isAllowedSingleSegment(segment, profile, commandCwd)
  );
}

function splitTopLevelPipelineSegments(command: string): string[] | undefined {
  const segments: string[] = [];
  let currentSegment = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaping = false;

  for (const char of command) {
    if (escaping) {
      currentSegment += char;
      escaping = false;
      continue;
    }

    if (inSingleQuote) {
      currentSegment += char;

      if (char === "'") {
        inSingleQuote = false;
      }

      continue;
    }

    if (char === "\\") {
      currentSegment += char;
      escaping = true;
      continue;
    }

    if (inDoubleQuote) {
      currentSegment += char;

      if (char === '"') {
        inDoubleQuote = false;
      }

      continue;
    }

    if (char === "'") {
      currentSegment += char;
      inSingleQuote = true;
      continue;
    }

    if (char === '"') {
      currentSegment += char;
      inDoubleQuote = true;
      continue;
    }

    if (char === "|") {
      segments.push(currentSegment);
      currentSegment = "";
      continue;
    }

    currentSegment += char;
  }

  if (escaping || inSingleQuote || inDoubleQuote) {
    return undefined;
  }

  segments.push(currentSegment);

  return segments;
}

function isAllowedSingleSegment(
  segment: string,
  profile: Pick<ReviewSessionProfile, "repoRoot" | "outputBaseDir">,
  commandCwd?: string
): boolean {
  const trimmed = segment.trim();

  if (!trimmed) {
    return false;
  }

  if (
    !ALLOWED_BASH_PREFIXES.some((prefix) =>
      matchesAllowedBashPrefix(trimmed, prefix)
    )
  ) {
    return false;
  }

  if (containsDangerousFlag(trimmed)) {
    return false;
  }

  return hasOnlyAllowedPathArguments(trimmed, profile, commandCwd);
}

function matchesAllowedBashPrefix(command: string, prefix: string): boolean {
  return command === prefix || command.startsWith(`${prefix} `);
}

function hasOnlyAllowedPathArguments(
  command: string,
  profile: Pick<ReviewSessionProfile, "repoRoot" | "outputBaseDir">,
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

    if (
      looksLikePath(token) &&
      !isAllowedReadPath(resolvePathToken(token, baseDirectory), profile)
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

function isAllowedReadPath(
  requestedPath: string,
  profile: Pick<ReviewSessionProfile, "repoRoot" | "outputBaseDir">
): boolean {
  const resolvedPath = path.resolve(requestedPath);
  const repoRoot = path.resolve(profile.repoRoot);
  const nightowlRoot = path.join(path.resolve(profile.repoRoot), ".nightowl");
  const reviewRoot = path.join(nightowlRoot, "review");

  const isWithinRepoSourceTree =
    resolvedPath === repoRoot ||
    (resolvedPath.startsWith(`${repoRoot}${path.sep}`) &&
      resolvedPath !== nightowlRoot &&
      !resolvedPath.startsWith(`${nightowlRoot}${path.sep}`));

  return (
    isWithinRepoSourceTree ||
    resolvedPath === reviewRoot ||
    resolvedPath.startsWith(`${reviewRoot}${path.sep}`)
  );
}
