import path from "node:path";

import { isAllowedReviewReadPath } from "../../core/review-access-guard.ts";

import {
  containsTopLevelRedirection,
  splitTopLevelSequenceSegments,
  splitTopLevelPipelineSegments
} from "./shell-command-parser.ts";
import type {
  ToolPolicyBoundaryContext,
  ToolPolicyDecisionDeny,
  ToolPolicyDecision
} from "./tool-policy-types.ts";

export type { ToolPolicyDecisionDeny, ToolPolicyDecision } from "./tool-policy-types.ts";

export const READONLY_BASH_DENY_REASON =
  "Review sessions only allow repo-local read-only shell analysis commands.";

// --- Command allow-list registry ---
//
// Each entry maps a command name to its argument-level policy.  Git uses a
// separate subcommand set rather than a per-binary entry so that `git -C`
// normalisation and subcommand validation can be handled in a single pass.
//
// Policy flags:
//   deniedFlags   – flags that MUST NOT appear (e.g. write / exec flags)
//   requiredFlags – at least one of these flags MUST be present

interface CommandPolicy {
  deniedFlags?: Set<string>;
  deniedFlagPrefixes?: string[];
  requiredFlags?: Set<string>;
}

const DEFAULT_POLICY: CommandPolicy = {};

const ALLOWED_COMMANDS = new Map<string, CommandPolicy>([
  // --- file / text inspection ---
  ["cat", DEFAULT_POLICY],
  ["ls", DEFAULT_POLICY],
  ["head", DEFAULT_POLICY],
  ["tail", DEFAULT_POLICY],
  ["nl", DEFAULT_POLICY],
  ["file", DEFAULT_POLICY],
  ["stat", DEFAULT_POLICY],
  ["tree", DEFAULT_POLICY],
  ["wc", DEFAULT_POLICY],
  ["diff", DEFAULT_POLICY],

  // --- search ---
  ["grep", DEFAULT_POLICY],
  ["rg", DEFAULT_POLICY],
  ["find", {
    deniedFlags: new Set(["-exec", "-execdir", "-delete", "-ok", "-okdir"])
  }],

  // --- text processing (typically pipeline-only) ---
  ["cut", DEFAULT_POLICY],
  ["sort", {
    deniedFlags: new Set(["-o"]),
    deniedFlagPrefixes: ["--output="]
  }],
  ["uniq", DEFAULT_POLICY],
  // awk is Turing-complete and can call system(); kept for convenience in
  // review pipelines (e.g. `awk '{print $1}'`).  The threat model accepts
  // this because the LLM is constrained by our system prompt and the user
  // controls what code is reviewed.
  ["awk", DEFAULT_POLICY],
  ["sed", {
    deniedFlags: new Set(["-i", "--in-place"]),
    requiredFlags: new Set(["-n"])
  }],

  // --- path utilities ---
  ["realpath", DEFAULT_POLICY],
  ["basename", DEFAULT_POLICY],
  ["dirname", DEFAULT_POLICY],

  // --- output formatting ---
  ["printf", DEFAULT_POLICY],
  ["echo", DEFAULT_POLICY],

  // --- navigation ---
  ["cd", DEFAULT_POLICY]
]);

const ALLOWED_GIT_SUBCOMMANDS = new Set([
  "diff",
  "show",
  "log",
  "status",
  "rev-parse",
  "merge-base",
  "rev-list",
  "ls-files",
  "blame",
  "grep",
  "cat-file"
]);

const GIT_POLICY: CommandPolicy = {
  deniedFlags: new Set(["-exec", "-execdir"]),
  deniedFlagPrefixes: ["--output="]
};

export function evaluateReadonlyShellCommand(
  command: string,
  profile: ToolPolicyBoundaryContext,
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
  profile: ToolPolicyBoundaryContext,
  commandCwd?: string
): boolean {
  const trimmedCommand = command.trim();

  if (!trimmedCommand) {
    return false;
  }

  if (/[`]/u.test(trimmedCommand) || /\$\(/u.test(trimmedCommand)) {
    return false;
  }

  const hasTopLevelRedirection = containsTopLevelRedirection(trimmedCommand);

  if (hasTopLevelRedirection !== false) {
    return false;
  }

  const sequenceSegments = splitTopLevelSequenceSegments(trimmedCommand);

  if (!sequenceSegments) {
    return false;
  }

  let effectiveCwd = commandCwd;

  for (const sequenceSegment of sequenceSegments) {
    const pipelineSegments = splitTopLevelPipelineSegments(sequenceSegment);

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

    const cdCwd = extractCdCwd(sequenceSegment, profile, effectiveCwd);

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
  profile: ToolPolicyBoundaryContext,
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
  profile: ToolPolicyBoundaryContext,
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

  const commandPolicy = resolveCommandPolicy(normalizedSegment.command);

  if (!commandPolicy) {
    return false;
  }

  if (!satisfiesCommandPolicy(normalizedSegment.command, commandPolicy)) {
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
  profile: ToolPolicyBoundaryContext,
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

/**
 * Resolve the command policy for a single segment.
 * Returns the CommandPolicy if the command is allowed, or undefined if not.
 * For `git`, the subcommand is validated against ALLOWED_GIT_SUBCOMMANDS.
 */
function resolveCommandPolicy(command: string): CommandPolicy | undefined {
  const tokens = command.split(/\s+/u).filter(Boolean);
  const commandName = tokens[0];

  if (!commandName) {
    return undefined;
  }

  if (commandName === "git") {
    const subcommand = tokens[1];

    if (!subcommand || !ALLOWED_GIT_SUBCOMMANDS.has(subcommand)) {
      return undefined;
    }

    return GIT_POLICY;
  }

  return ALLOWED_COMMANDS.get(commandName);
}

/**
 * Check that a command satisfies per-command denied/required flag constraints.
 */
function satisfiesCommandPolicy(command: string, policy: CommandPolicy): boolean {
  const tokens = command.split(/\s+/u).filter(Boolean);

  if (policy.deniedFlags) {
    for (const token of tokens) {
      if (policy.deniedFlags.has(token)) {
        return false;
      }
    }
  }

  if (policy.deniedFlagPrefixes) {
    for (const token of tokens) {
      if (policy.deniedFlagPrefixes.some((prefix) => token.startsWith(prefix))) {
        return false;
      }
    }
  }

  if (policy.requiredFlags) {
    const hasRequired = tokens.some((token) => policy.requiredFlags!.has(token));

    if (!hasRequired) {
      return false;
    }
  }

  return true;
}

function hasOnlyAllowedPathArguments(
  command: string,
  profile: ToolPolicyBoundaryContext,
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
