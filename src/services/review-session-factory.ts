import {
  type PermissionHandler,
  type PreToolUseHookOutput,
  type SessionConfig
} from "@github/copilot-sdk";
import path from "node:path";

import type { ReviewKnowledgeMode } from "../core/review-knowledge-mode.ts";
import {
  CopilotClientManager,
  SessionExecutor
} from "./session-executor.ts";
import type { KnowledgeSvc } from "./knowledge.ts";

export interface ReviewSessionProfile {
  knowledgeMode?: ReviewKnowledgeMode;
  model: string;
  outputBaseDir: string;
  repoRoot: string;
  systemMessage: string;
  workingDirectory?: string;
}

export interface ReviewSessionFactoryOptions {
  clientManager: Pick<CopilotClientManager, "getClient">;
  knowledgeSvc?: Pick<KnowledgeSvc, "getMcpServers">;
}

export class ReviewSessionFactory {
  readonly #clientManager: Pick<CopilotClientManager, "getClient">;
  readonly #knowledgeSvc?: Pick<KnowledgeSvc, "getMcpServers">;

  constructor(options: ReviewSessionFactoryOptions) {
    this.#clientManager = options.clientManager;
    this.#knowledgeSvc = options.knowledgeSvc;
  }

  async createSession(profile: ReviewSessionProfile): Promise<SessionExecutor> {
    const sessionConfig: SessionConfig = {
      excludedTools: ["web_fetch"],
      hooks: {
        onPreToolUse: createReviewPreToolUseHook(profile)
      },
      model: profile.model,
      streaming: false,
      systemMessage: {
        mode: "replace",
        content: profile.systemMessage
      },
      onPermissionRequest: createReviewPermissionHandler(profile)
    };

    const mcpServers = this.#knowledgeSvc?.getMcpServers(
      profile.knowledgeMode ?? "disabled"
    );

    if (mcpServers) {
      sessionConfig.mcpServers = mcpServers;
    }

    if (profile.workingDirectory) {
      sessionConfig.workingDirectory = profile.workingDirectory;
    }

    const session = await this.#clientManager.getClient().createSession(sessionConfig);

    return new SessionExecutor(session);
  }
}

function createReviewPermissionHandler(
  profile: Pick<ReviewSessionProfile, "repoRoot" | "outputBaseDir">
): PermissionHandler {
  return async (request) => {
    if (
      request.kind === "read" &&
      typeof request.path === "string" &&
      isAllowedReadPath(request.path, profile)
    ) {
      return { kind: "approved" };
    }

    return { kind: "denied-no-approval-rule-and-could-not-request-from-user" };
  };
}

function createReviewPreToolUseHook(
  profile: Pick<ReviewSessionProfile, "repoRoot" | "outputBaseDir">
) {
  return async (input): Promise<PreToolUseHookOutput | void> => {
    if (input.toolName !== "bash") {
      return;
    }

    const command =
      input.toolArgs &&
      typeof input.toolArgs === "object" &&
      "command" in input.toolArgs &&
      typeof input.toolArgs.command === "string"
        ? input.toolArgs.command
        : "";

    if (isAllowedReadonlyBashCommand(command, profile)) {
      return;
    }

    return {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow repo-local read-only bash analysis commands."
    };
  };
}

function isAllowedReadPath(
  requestedPath: string,
  profile: Pick<ReviewSessionProfile, "repoRoot" | "outputBaseDir">
): boolean {
  const resolvedPath = path.resolve(requestedPath);
  const repoRoot = path.resolve(profile.repoRoot);
  const reviewRoot = path.join(path.resolve(profile.outputBaseDir), "review");

  return (
    resolvedPath === repoRoot ||
    resolvedPath.startsWith(`${repoRoot}${path.sep}`) ||
    resolvedPath === reviewRoot ||
    resolvedPath.startsWith(`${reviewRoot}${path.sep}`)
  );
}

function isAllowedReadonlyBashCommand(
  command: string,
  profile: Pick<ReviewSessionProfile, "repoRoot" | "outputBaseDir">
): boolean {
  if (!command.trim()) {
    return false;
  }

  if (/[;&|`><]/u.test(command) || /\$\(/u.test(command)) {
    return false;
  }

  if (!ALLOWED_BASH_PREFIXES.some((prefix) => command.startsWith(prefix))) {
    return false;
  }

  if (containsDangerousFlag(command)) {
    return false;
  }

  return hasOnlyAllowedPathArguments(command, profile);
}

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
  "cat ",
  "ls",
  "head ",
  "tail ",
  "find ",
  "rg ",
  "grep ",
  "sed -n",
  "cut ",
  "sort",
  "uniq",
  "wc -l"
];

const DANGEROUS_BASH_FLAGS = new Set(["-o", "--output"]);

function hasOnlyAllowedPathArguments(
  command: string,
  profile: Pick<ReviewSessionProfile, "repoRoot" | "outputBaseDir">
): boolean {
  const tokens = command.split(/\s+/u).filter(Boolean);

  for (const token of tokens.slice(1)) {
    if (token === "--") {
      continue;
    }

    if (token.startsWith("-")) {
      continue;
    }

    if (
      looksLikePath(token) &&
      !isAllowedReadPath(resolvePathToken(token), profile)
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

function resolvePathToken(token: string): string {
  if (token === "~") {
    return process.env.HOME ?? token;
  }

  if (token.startsWith("~/")) {
    return path.join(process.env.HOME ?? "", token.slice(2));
  }

  return token;
}

function containsDangerousFlag(command: string): boolean {
  const tokens = command.split(/\s+/u).filter(Boolean);

  return tokens.some(
    (token) => DANGEROUS_BASH_FLAGS.has(token) || token.startsWith("--output=")
  );
}
