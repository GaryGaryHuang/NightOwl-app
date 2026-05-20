import path from "node:path";

import {
  nightowlRoot,
  reviewOutputRoot as buildReviewOutputRoot
} from "../../core/nightowl-namespace.ts";
import { isAllowedReviewReadPath } from "../../core/review-access-guard.ts";

import {
  containsShellExpansion,
  containsTopLevelRedirection,
  splitShellCommandWords,
  splitTopLevelPipelineSegments,
  splitTopLevelSequenceSegments
} from "./shell-command-parser.ts";
import type {
  ToolPolicyBoundaryContext,
  ToolPolicyDecision,
  ToolPolicyDecisionDeny
} from "./tool-policy-types.ts";

export type { ToolPolicyDecision, ToolPolicyDecisionDeny } from "./tool-policy-types.ts";

export const READONLY_BASH_DENY_REASON =
  "Review sessions only allow repo-local read-only shell analysis commands.";

interface CommandPolicy {
  deniedFlags?: Set<string>;
  deniedFlagPrefixes?: string[];
  requiredFlags?: Set<string>;
}

interface NormalizedCommandSegment {
  tokens: string[];
  baseDirectory?: string;
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

  // --- text processing ---
  ["cut", DEFAULT_POLICY],
  ["sort", {
    deniedFlags: new Set(["-o"]),
    deniedFlagPrefixes: ["--output="]
  }],
  ["uniq", DEFAULT_POLICY],
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

  const hasShellExpansion = containsShellExpansion(trimmedCommand);

  if (hasShellExpansion !== false) {
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

function extractCdCwd(
  chainSegment: string,
  profile: ToolPolicyBoundaryContext,
  effectiveCwd?: string
): string | false | undefined {
  const tokens = splitShellCommandWords(chainSegment.trim());

  if (!tokens || tokens[0] !== "cd") {
    return undefined;
  }

  const pathToken = tokens.slice(1).find((token) => !token.startsWith("-"));

  if (!pathToken) {
    return false;
  }

  const baseDirectory = resolveAllowedBaseDirectory(profile, effectiveCwd);

  if (baseDirectory === undefined) {
    return false;
  }

  const resolvedPath = resolvePathToken(pathToken, baseDirectory);

  if (!isAllowedReviewReadPath(resolvedPath, profile)) {
    return false;
  }

  return resolvedPath;
}

function isAllowedSingleSegment(
  segment: string,
  profile: ToolPolicyBoundaryContext,
  commandCwd?: string
): boolean {
  const normalizedSegment = normalizeGitChangeDirectorySegment(
    segment.trim(),
    profile,
    commandCwd
  );

  if (!normalizedSegment) {
    return false;
  }

  const commandPolicy = resolveCommandPolicy(normalizedSegment.tokens);

  if (!commandPolicy) {
    return false;
  }

  if (!satisfiesCommandPolicy(normalizedSegment.tokens, commandPolicy)) {
    return false;
  }

  return hasOnlyAllowedPathArguments(
    normalizedSegment.tokens,
    profile,
    normalizedSegment.baseDirectory
  );
}

function normalizeGitChangeDirectorySegment(
  command: string,
  profile: ToolPolicyBoundaryContext,
  commandCwd?: string
): NormalizedCommandSegment | undefined {
  const tokens = splitShellCommandWords(command);

  if (!tokens || tokens.length === 0) {
    return undefined;
  }

  if (tokens[0] !== "git") {
    return {
      tokens,
      baseDirectory: commandCwd
    };
  }

  let baseDirectory = commandCwd;
  let gitArgumentIndex = 1;
  let seenChangeDirectory = false;

  while (gitArgumentIndex < tokens.length) {
    const token = tokens[gitArgumentIndex];

    if (token === "--no-pager") {
      gitArgumentIndex += 1;
      continue;
    }

    if (token !== "-C") {
      break;
    }

    if (seenChangeDirectory) {
      return undefined;
    }

    const pathToken = tokens[gitArgumentIndex + 1];

    if (!pathToken || !path.isAbsolute(pathToken)) {
      return undefined;
    }

    const currentBaseDirectory =
      typeof baseDirectory === "string" && baseDirectory.trim()
        ? baseDirectory
        : profile.repoRoot;
    const resolvedPath = resolvePathToken(pathToken, currentBaseDirectory);

    if (!isAllowedGitWorkingDirectory(resolvedPath, profile)) {
      return undefined;
    }

    baseDirectory = resolvedPath;
    seenChangeDirectory = true;
    gitArgumentIndex += 2;
  }

  if (gitArgumentIndex >= tokens.length) {
    return undefined;
  }

  return {
    tokens: ["git", ...tokens.slice(gitArgumentIndex)],
    baseDirectory
  };
}

function resolveCommandPolicy(tokens: readonly string[]): CommandPolicy | undefined {
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

function satisfiesCommandPolicy(tokens: readonly string[], policy: CommandPolicy): boolean {
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
  tokens: readonly string[],
  profile: ToolPolicyBoundaryContext,
  commandCwd?: string
): boolean {
  if (isSnapshotBackedGitCommand(tokens, profile)) {
    const baseDirectory = resolveAllowedBaseDirectory(profile, commandCwd, {
      sourceOnly: true
    });

    return (
      baseDirectory !== undefined &&
      isAllowedSnapshotGitEvidenceCommand(tokens, profile)
    );
  }

  const baseDirectory = resolveAllowedBaseDirectory(profile, commandCwd);

  if (baseDirectory === undefined) {
    return false;
  }

  if (hasDisallowedSnapshotPreprocessHook(tokens, profile)) {
    return false;
  }

  if (hasDisallowedSnapshotRootEnumeration(tokens, profile, baseDirectory)) {
    return false;
  }

  for (const token of tokens.slice(1)) {
    if (token === "--") {
      continue;
    }

    if (token.startsWith("-")) {
      continue;
    }

    if (
      shouldValidatePathToken(token) &&
      !isAllowedReviewReadPath(resolvePathToken(token, baseDirectory), profile)
    ) {
      return false;
    }
  }

  return true;
}

function resolveAllowedBaseDirectory(
  profile: ToolPolicyBoundaryContext,
  commandCwd?: string,
  options: { sourceOnly?: boolean } = {}
): string | undefined {
  const candidate =
    typeof commandCwd === "string" && commandCwd.trim()
      ? path.resolve(commandCwd)
      : profile.repoRoot;

  if (!isAllowedReviewReadPath(candidate, profile)) {
    return undefined;
  }

  if (options.sourceOnly === true && !isSourceTreePath(candidate, profile)) {
    return undefined;
  }

  return candidate;
}

function isSnapshotBackedGitCommand(
  tokens: readonly string[],
  profile: ToolPolicyBoundaryContext
): boolean {
  return isSnapshotBackedProfile(profile) && tokens[0] === "git";
}

function isSnapshotBackedProfile(profile: ToolPolicyBoundaryContext): boolean {
  return (
    profile.reviewOutputRoot !== undefined &&
    path.resolve(profile.reviewOutputRoot) !==
      path.resolve(buildReviewOutputRoot(profile.repoRoot))
  );
}

function isAllowedGitWorkingDirectory(
  candidate: string,
  profile: ToolPolicyBoundaryContext
): boolean {
  if (!isAllowedReviewReadPath(candidate, profile)) {
    return false;
  }

  if (!isSnapshotBackedProfile(profile)) {
    return true;
  }

  return isSourceTreePath(candidate, profile);
}

function isSourceTreePath(
  candidate: string,
  profile: ToolPolicyBoundaryContext
): boolean {
  const resolvedCandidate = path.resolve(candidate);
  const resolvedSourceRoot = path.resolve(profile.repoRoot);
  const resolvedNightOwlRoot = path.resolve(nightowlRoot(resolvedSourceRoot));

  return (
    isPathInsideOrEqual(resolvedCandidate, resolvedSourceRoot) &&
    !isPathInsideOrEqual(resolvedCandidate, resolvedNightOwlRoot)
  );
}

function isPathInsideOrEqual(candidate: string, boundary: string): boolean {
  return candidate === boundary || candidate.startsWith(`${boundary}${path.sep}`);
}

function hasDisallowedSnapshotPreprocessHook(
  tokens: readonly string[],
  profile: ToolPolicyBoundaryContext
): boolean {
  return isSnapshotBackedProfile(profile) &&
    tokens[0] === "rg" &&
    tokens.some((token) => token === "--pre" || token.startsWith("--pre="));
}

function hasDisallowedSnapshotRootEnumeration(
  tokens: readonly string[],
  profile: ToolPolicyBoundaryContext,
  baseDirectory: string
): boolean {
  if (!isSnapshotBackedProfile(profile)) {
    return false;
  }

  const commandName = tokens[0];

  if (!commandName) {
    return false;
  }

  const nonFlagArgs = tokens
    .slice(1)
    .filter((token) => token !== "--" && !token.startsWith("-"));
  const cwdIsSourceRoot = path.resolve(baseDirectory) === path.resolve(profile.repoRoot);
  const targetIsSourceRoot = (target: string): boolean =>
    path.resolve(resolvePathToken(target, baseDirectory)) ===
      path.resolve(profile.repoRoot);

  switch (commandName) {
    case "find": {
      const firstArg = tokens[1];
      const hasExplicitFindTarget =
        firstArg !== undefined &&
        !firstArg.startsWith("-") &&
        firstArg !== "(" &&
        firstArg !== "!" &&
        firstArg !== ")";
      const findTargets = hasExplicitFindTarget ? nonFlagArgs : [];

      return findTargets.length === 0
        ? cwdIsSourceRoot
        : findTargets.some(targetIsSourceRoot);
    }

    case "grep":
      return hasRecursiveFlag(tokens) &&
        nonFlagArgs.slice(1).some(targetIsSourceRoot);

    case "rg":
      return hasRipgrepHiddenTraversalFlag(tokens) &&
        (nonFlagArgs.length <= 1
          ? cwdIsSourceRoot
          : nonFlagArgs.slice(1).some(targetIsSourceRoot));

    case "ls":
    case "tree":
      return hasHiddenListingFlag(tokens) &&
        (nonFlagArgs.length === 0
          ? cwdIsSourceRoot
          : nonFlagArgs.some(targetIsSourceRoot));

    default:
      return false;
  }
}

function hasRecursiveFlag(tokens: readonly string[]): boolean {
  return tokens.some((token) =>
    token === "-R" ||
    token === "-r" ||
    (/^-[^-]/u.test(token) && /[Rr]/u.test(token))
  );
}

function hasRipgrepHiddenTraversalFlag(tokens: readonly string[]): boolean {
  return tokens.some((token) =>
    token === "--hidden" ||
    token === "-uuu" ||
    token === "--unrestricted"
  );
}

function hasHiddenListingFlag(tokens: readonly string[]): boolean {
  return tokens.some((token) =>
    token === "--all" ||
    token === "--almost-all" ||
    token === "-a" ||
    token === "-A" ||
    (/^-[^-]/u.test(token) && /[aA]/u.test(token))
  );
}

function isAllowedSnapshotGitEvidenceCommand(
  tokens: readonly string[],
  profile: ToolPolicyBoundaryContext
): boolean {
  const subcommand = tokens[1];
  const args = tokens.slice(2);

  switch (subcommand) {
    case "diff":
      return isAllowedSnapshotGitDiff(args, profile);

    case "show":
      return isAllowedSnapshotGitShow(args, profile);

    case "grep":
      return isAllowedSnapshotGitGrep(args, profile);

    default:
      return false;
  }
}

function isAllowedSnapshotGitDiff(
  args: readonly string[],
  profile: ToolPolicyBoundaryContext
): boolean {
  if (
    profile.sourceBaseRef === undefined ||
    profile.sourceHeadRef === undefined
  ) {
    return false;
  }

  const separatorIndex = args.indexOf("--");
  const expectedRange = `${profile.sourceBaseRef}...${profile.sourceHeadRef}`;

  return separatorIndex === 1 &&
    args[0] === expectedRange &&
    areAllowedSnapshotGitSourcePaths(args.slice(separatorIndex + 1), profile);
}

function isAllowedSnapshotGitShow(
  args: readonly string[],
  profile: ToolPolicyBoundaryContext
): boolean {
  return args.length === 1 &&
    isAllowedSnapshotGitObjectPath(args[0]!, profile);
}

function isAllowedSnapshotGitGrep(
  args: readonly string[],
  profile: ToolPolicyBoundaryContext
): boolean {
  const normalizedArgs = args[0] === "-n" ? args.slice(1) : args;
  const separatorIndex = normalizedArgs.indexOf("--");

  if (separatorIndex !== 2) {
    return false;
  }

  const pattern = normalizedArgs[0];
  const revision = normalizedArgs[1];

  return pattern !== undefined &&
    pattern.length > 0 &&
    !pattern.startsWith("-") &&
    revision !== undefined &&
    isAllowedSnapshotGitRunRef(revision, profile) &&
    areAllowedSnapshotGitSourcePaths(
      normalizedArgs.slice(separatorIndex + 1),
      profile
    );
}

function isAllowedSnapshotGitObjectPath(
  token: string,
  profile: ToolPolicyBoundaryContext
): boolean {
  const colonIndex = token.indexOf(":");

  if (colonIndex <= 0) {
    return false;
  }

  return isAllowedSnapshotGitRunRef(token.slice(0, colonIndex), profile) &&
    isAllowedSnapshotGitSourcePath(token.slice(colonIndex + 1), profile);
}

function areAllowedSnapshotGitSourcePaths(
  pathspecs: readonly string[],
  profile: ToolPolicyBoundaryContext
): boolean {
  return pathspecs.length > 0 &&
    pathspecs.every((token) => isAllowedSnapshotGitSourcePath(token, profile));
}

function isAllowedSnapshotGitSourcePath(
  token: string,
  profile: ToolPolicyBoundaryContext
): boolean {
  if (token.length === 0 || token.startsWith(":")) {
    return false;
  }

  const resolvedPath = resolvePathToken(token, profile.repoRoot);

  return (
    isAllowedReviewReadPath(resolvedPath, profile) &&
    isSourceTreePath(resolvedPath, profile) &&
    path.resolve(resolvedPath) !== path.resolve(profile.repoRoot)
  );
}

function isAllowedSnapshotGitRunRef(
  revision: string,
  profile: ToolPolicyBoundaryContext
): boolean {
  return revision === "HEAD" ||
    revision === "@" ||
    revision === profile.sourceBaseRef ||
    revision === profile.sourceHeadRef;
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

function shouldValidatePathToken(token: string): boolean {
  return (
    looksLikePath(token) ||
    token === "." ||
    token === ".." ||
    token === ".nightowl"
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
