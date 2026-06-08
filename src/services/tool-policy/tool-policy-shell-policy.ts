import path from "node:path";

import { reviewOutputRoot as buildReviewOutputRoot } from "../../core/nightowl-namespace.ts";
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
  ToolPolicyDecision
} from "./tool-policy-types.ts";

export const READONLY_BASH_DENY_REASON =
  "Review sessions only allow simple literal shell commands for repo-local read-only analysis that built-in retrieval tools cannot express. Common allowed shell examples: `rg`, `grep`, `find`, `ls`, `cat`, `sed -n`, `git diff <baseRef>...<headRef> -- <path>`, `git show <ref>:<path>`, and `git grep <pattern> <ref> -- <path>`. A plain working-tree `git diff` is rejected; use ref-bound forms.";
export const SNAPSHOT_BACKED_BASH_DENY_REASON =
  "This snapshot-backed shell command is not supported. Do not retry the denied diff, working-tree, or branch-ref form. For review-scope changes, use the current prompt input (`<changed_files_json>`, `<diff>`, or `<review_state>`). For additional source lookup, follow the repository-inspection policy in the system message and use available retrieval tools or policy-allowed HEAD-side bash Git lookups.";
export const SHELL_COMMAND_SUBSTITUTION_DENY_REASON =
  "Command substitution (`$(...)` or backticks) is not allowed in review shell commands. Run the inner read-only command as a separate tool call, then retry with a literal value or use a built-in retrieval tool.";
export const SHELL_REDIRECTION_DENY_REASON =
  "Shell redirection (`<`, `>`, `>>`) is not allowed in review sessions. Tool output is returned directly; pass literal file paths as command arguments, or pipe between allowed read-only commands when you need to combine output.";
export const SHELL_EXPANSION_DENY_REASON =
  "Shell expansion is not allowed in review shell commands: glob (`*`, `?`, `[...]`), brace (`{...}`), `~`, and `$` variable or parameter expansion. Use literal paths. Discover file paths with `glob`; use `grep` or `rg` for content search.";

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
  ["pwd", DEFAULT_POLICY],
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
  const denyReason = classifyReadonlyBashDenial(command, profile, commandCwd);

  return denyReason === undefined
    ? undefined
    : {
        permissionDecision: "deny",
        permissionDecisionReason: denyReason
      };
}

// Classify why a command is rejected so the model receives targeted guidance.
// Returns undefined when the command is an allowed read-only analysis command.
// Syntax-level rejections (substitution, redirection, expansion) get specific
// reasons; command-, path-, and git-form-level rejections share the general
// READONLY_BASH_DENY_REASON, which summarizes the allowed surface.
function classifyReadonlyBashDenial(
  command: string,
  profile: ToolPolicyBoundaryContext,
  commandCwd?: string
): string | undefined {
  const trimmedCommand = command.trim();

  const generalBashDenyReason = isSnapshotBackedProfile(profile)
    ? SNAPSHOT_BACKED_BASH_DENY_REASON
    : READONLY_BASH_DENY_REASON;

  if (!trimmedCommand) {
    return generalBashDenyReason;
  }

  if (/[`]/u.test(trimmedCommand) || /\$\(/u.test(trimmedCommand)) {
    return SHELL_COMMAND_SUBSTITUTION_DENY_REASON;
  }

  const redirection = containsTopLevelRedirection(trimmedCommand);

  if (redirection === true) {
    return SHELL_REDIRECTION_DENY_REASON;
  }

  const expansion = containsShellExpansion(trimmedCommand);

  if (expansion === true) {
    return SHELL_EXPANSION_DENY_REASON;
  }

  // Ambiguous input (for example unclosed quotes) is denied conservatively with
  // the general reason rather than a misleading syntax-specific one.
  if (redirection === undefined || expansion === undefined) {
    return generalBashDenyReason;
  }

  const sequenceSegments = splitTopLevelSequenceSegments(trimmedCommand);

  if (!sequenceSegments) {
    return generalBashDenyReason;
  }

  let effectiveCwd = commandCwd;

  for (const sequenceSegment of sequenceSegments) {
    const pipelineSegments = splitTopLevelPipelineSegments(sequenceSegment);

    if (!pipelineSegments) {
      return generalBashDenyReason;
    }

    if (
      !pipelineSegments.every((segment) =>
        isAllowedSingleSegment(segment, profile, effectiveCwd)
      )
    ) {
      return generalBashDenyReason;
    }

    const cdCwd = extractCdCwd(sequenceSegment, profile, effectiveCwd);

    if (cdCwd === false) {
      return generalBashDenyReason;
    }

    if (cdCwd !== undefined) {
      effectiveCwd = cdCwd;
    }
  }

  return undefined;
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

    if (baseDirectory === undefined) {
      return false;
    }

    return isAllowedSnapshotGitEvidenceCommand(tokens, profile, baseDirectory);
  }

  const baseDirectory = resolveAllowedBaseDirectory(profile, commandCwd);

  if (baseDirectory === undefined) {
    return false;
  }

  if (
    isSnapshotBackedProfile(profile) &&
    hasDisallowedSnapshotPreprocessHook(tokens)
  ) {
    return false;
  }

  if (tokens[0] === "git" && !hasOnlyAllowedGitObjectPaths(tokens, profile)) {
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
      (shouldValidatePathToken(token) ||
        isReviewArtifactPath(resolvePathToken(token, baseDirectory), profile)) &&
      !isAllowedReviewReadPath(resolvePathToken(token, baseDirectory), profile)
    ) {
      return false;
    }
  }

  return true;
}

function isAllowedSnapshotGitEvidenceCommand(
  tokens: readonly string[],
  profile: ToolPolicyBoundaryContext,
  baseDirectory: string
): boolean {
  switch (tokens[1]) {
    case "diff":
      return isAllowedSnapshotGitDiff(tokens, profile, baseDirectory);
    case "show":
      return isAllowedSnapshotGitShow(tokens, profile, baseDirectory);
    case "grep":
      return isAllowedSnapshotGitGrep(tokens, profile, baseDirectory);
    default:
      return false;
  }
}

function isAllowedSnapshotGitDiff(
  tokens: readonly string[],
  profile: ToolPolicyBoundaryContext,
  baseDirectory: string
): boolean {
  const refs = getSnapshotSourceRefs(profile);

  if (!refs) {
    return false;
  }

  const args = tokens[2] === "--stat" ? tokens.slice(3) : tokens.slice(2);
  let separatorIndex: number;

  if (args[0] === `${refs.sourceBaseRef}...${refs.sourceHeadRef}`) {
    separatorIndex = 1;
  } else if (
    args[0] === refs.sourceBaseRef &&
    args[1] === refs.sourceHeadRef
  ) {
    separatorIndex = 2;
  } else {
    return false;
  }

  if (args[separatorIndex] !== "--") {
    return false;
  }

  return areAllowedSnapshotGitSourcePaths(
    args.slice(separatorIndex + 1),
    profile,
    baseDirectory
  );
}

function isAllowedSnapshotGitShow(
  tokens: readonly string[],
  profile: ToolPolicyBoundaryContext,
  baseDirectory: string
): boolean {
  if (tokens.length !== 3) {
    return false;
  }

  const objectPath = tokens[2];

  if (!objectPath) {
    return false;
  }

  const separatorIndex = objectPath.indexOf(":");

  if (separatorIndex <= 0) {
    return false;
  }

  const runRef = objectPath.slice(0, separatorIndex);
  const sourcePath = objectPath.slice(separatorIndex + 1);

  return (
    isAllowedSnapshotGitRunRef(runRef, profile) &&
    isAllowedSnapshotGitSourcePath(sourcePath, profile, profile.repoRoot)
  );
}

function isAllowedSnapshotGitGrep(
  tokens: readonly string[],
  profile: ToolPolicyBoundaryContext,
  baseDirectory: string
): boolean {
  let index = 2;

  if (tokens[index] === "-n") {
    index += 1;
  }

  const pattern = tokens[index];

  if (!pattern || pattern.startsWith("-")) {
    return false;
  }

  index += 1;

  const runRef = tokens[index];

  if (!runRef || !isAllowedSnapshotGitRunRef(runRef, profile)) {
    return false;
  }

  index += 1;

  if (tokens[index] !== "--") {
    return false;
  }

  return areAllowedSnapshotGitSourcePaths(
    tokens.slice(index + 1),
    profile,
    baseDirectory
  );
}

function getSnapshotSourceRefs(profile: ToolPolicyBoundaryContext):
  | { sourceBaseRef: string; sourceHeadRef: string }
  | undefined {
  const sourceBaseRef = profile.sourceBaseRef?.trim();
  const sourceHeadRef = profile.sourceHeadRef?.trim();

  if (!sourceBaseRef || !sourceHeadRef) {
    return undefined;
  }

  return { sourceBaseRef, sourceHeadRef };
}

function isAllowedSnapshotGitRunRef(
  ref: string,
  profile: ToolPolicyBoundaryContext
): boolean {
  if (ref === "HEAD" || ref === "@") {
    return true;
  }

  return ref === profile.sourceBaseRef || ref === profile.sourceHeadRef;
}

function areAllowedSnapshotGitSourcePaths(
  sourcePaths: readonly string[],
  profile: ToolPolicyBoundaryContext,
  baseDirectory: string
): boolean {
  return (
    sourcePaths.length > 0 &&
    sourcePaths.every((sourcePath) =>
      isAllowedSnapshotGitSourcePath(sourcePath, profile, baseDirectory)
    )
  );
}

function isAllowedSnapshotGitSourcePath(
  sourcePath: string,
  profile: ToolPolicyBoundaryContext,
  baseDirectory: string
): boolean {
  if (sourcePath.length === 0 || sourcePath.startsWith(":")) {
    return false;
  }

  return isSourceTreePath(resolvePathToken(sourcePath, baseDirectory), profile);
}

function hasOnlyAllowedGitObjectPaths(
  tokens: readonly string[],
  profile: ToolPolicyBoundaryContext
): boolean {
  const subcommand = tokens[1];

  if (subcommand !== "show" && subcommand !== "cat-file") {
    return true;
  }

  return tokens
    .slice(2)
    .filter((token) => token !== "--" && !token.startsWith("-"))
    .every((token) => isAllowedGitObjectPathToken(token, profile));
}

function isAllowedGitObjectPathToken(
  token: string,
  profile: ToolPolicyBoundaryContext
): boolean {
  const separatorIndex = token.indexOf(":");

  if (separatorIndex <= 0) {
    return true;
  }

  const objectPath = token.slice(separatorIndex + 1);

  if (!objectPath || objectPath.startsWith(":")) {
    return false;
  }

  const resolvedObjectPath = resolvePathToken(objectPath, profile.repoRoot);

  return isAllowedReviewReadPath(resolvedObjectPath, profile);
}

function hasDisallowedSnapshotPreprocessHook(tokens: readonly string[]): boolean {
  return (
    tokens[0] === "rg" &&
    tokens.some((token) => token === "--pre" || token.startsWith("--pre="))
  );
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
  return isAllowedReviewReadPath(candidate, profile);
}

function isReviewArtifactPath(
  candidate: string,
  profile: ToolPolicyBoundaryContext
): boolean {
  const resolvedCandidate = path.resolve(candidate);
  const resolvedReviewRoot = path.resolve(
    buildReviewOutputRoot(path.resolve(profile.repoRoot))
  );

  return isPathInsideOrEqual(resolvedCandidate, resolvedReviewRoot);
}

function isPathInsideOrEqual(candidate: string, boundary: string): boolean {
  return candidate === boundary || candidate.startsWith(`${boundary}${path.sep}`);
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
