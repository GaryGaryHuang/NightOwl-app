import {
  type PermissionHandler,
  type PreToolUseHookOutput,
  type SessionConfig
} from "@github/copilot-sdk";
import { isIP } from "node:net";
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
  webFetchAllowedHosts?: string[];
}

export class ReviewSessionFactory {
  readonly #clientManager: Pick<CopilotClientManager, "getClient">;
  readonly #knowledgeSvc?: Pick<KnowledgeSvc, "getMcpServers">;
  readonly #webFetchAllowedHosts?: Set<string>;
  readonly #webFetchWildcardSuffixes?: readonly string[];

  constructor(options: ReviewSessionFactoryOptions) {
    this.#clientManager = options.clientManager;
    this.#knowledgeSvc = options.knowledgeSvc;

    if (options.webFetchAllowedHosts === undefined) {
      this.#webFetchAllowedHosts = undefined;
      this.#webFetchWildcardSuffixes = undefined;
    } else {
      const exactHosts = new Set<string>();
      const wildcardSuffixes: string[] = [];
      for (const host of options.webFetchAllowedHosts) {
        if (host.startsWith("*.")) {
          wildcardSuffixes.push(`.${host.slice(2)}`);
        } else {
          exactHosts.add(canonicalizeHostnameForComparison(host));
        }
      }
      this.#webFetchAllowedHosts = exactHosts;
      this.#webFetchWildcardSuffixes = wildcardSuffixes;
    }
  }

  async createSession(profile: ReviewSessionProfile): Promise<SessionExecutor> {
    const sessionConfig: SessionConfig = {
      hooks: {
        onPreToolUse: createReviewPreToolUseHook(
          profile,
          this.#webFetchAllowedHosts,
          this.#webFetchWildcardSuffixes
        )
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
      profile.knowledgeMode ?? "built-in-context7"
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
  profile: Pick<ReviewSessionProfile, "repoRoot" | "outputBaseDir">,
  webFetchAllowedHosts?: ReadonlySet<string>,
  webFetchWildcardSuffixes?: readonly string[]
) {
  return async (input): Promise<PreToolUseHookOutput | void> => {
    if (input.toolName === "web_fetch") {
      const url =
        input.toolArgs &&
        typeof input.toolArgs === "object" &&
        "url" in input.toolArgs &&
        typeof input.toolArgs.url === "string"
          ? input.toolArgs.url
          : "";

      const parsedUrl = parseAllowedWebFetchUrl(url);

      if (!parsedUrl) {
        return {
          permissionDecision: "deny",
          permissionDecisionReason:
            "Review sessions only allow web_fetch for absolute public http(s) URLs."
        };
      }

      if (webFetchAllowedHosts !== undefined) {
        const normalizedHostname = canonicalizeHostnameForComparison(parsedUrl.hostname);
        if (
          !webFetchAllowedHosts.has(normalizedHostname) &&
          !(webFetchWildcardSuffixes ?? []).some((suffix) =>
            normalizedHostname.endsWith(suffix)
          )
        ) {
          return {
            permissionDecision: "deny",
            permissionDecisionReason:
              "Review sessions only allow web_fetch for configured public http(s) hosts."
          };
        }
      }

      return;
    }

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

function parseAllowedWebFetchUrl(urlString: string): URL | undefined {
  let parsed: URL;

  try {
    parsed = new URL(urlString);
  } catch {
    return undefined;
  }

  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    !parsed.hostname
  ) {
    return undefined;
  }

  const normalizedHostname = normalizeHostnameForNetworkChecks(parsed.hostname);

  if (normalizedHostname === "localhost") {
    return undefined;
  }

  const ipVersion = isIP(normalizedHostname);

  if (ipVersion === 4) {
    return isDisallowedIpv4(normalizedHostname) ? undefined : parsed;
  }

  if (ipVersion === 6) {
    return isDisallowedIpv6(normalizedHostname) ? undefined : parsed;
  }

  return parsed;
}

function normalizeHostnameForNetworkChecks(hostname: string): string {
  const lowercaseHostname = hostname.toLowerCase();

  return lowercaseHostname.startsWith("[") && lowercaseHostname.endsWith("]")
    ? lowercaseHostname.slice(1, -1)
    : lowercaseHostname;
}

function canonicalizeHostnameForComparison(hostname: string): string {
  return normalizeHostnameForNetworkChecks(hostname).replace(/\.$/u, "");
}

function isDisallowedIpv4(hostname: string): boolean {
  const octets = hostname.split(".").map((value) => Number.parseInt(value, 10));

  if (octets.length !== 4 || octets.some((value) => Number.isNaN(value))) {
    return true;
  }

  if (octets[0] === 10 || octets[0] === 127) {
    return true;
  }

  if (octets[0] === 169 && octets[1] === 254) {
    return true;
  }

  if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) {
    return true;
  }

  if (octets[0] === 192 && octets[1] === 168) {
    return true;
  }

  return false;
}

function isDisallowedIpv6(hostname: string): boolean {
  const mappedIpv4 = extractMappedIpv4(hostname);

  if (mappedIpv4) {
    return isDisallowedIpv4(mappedIpv4);
  }

  return (
    hostname === "::1" ||
    hostname.startsWith("fc") ||
    hostname.startsWith("fd") ||
    /^fe[89ab]/u.test(hostname)
  );
}

function extractMappedIpv4(hostname: string): string | undefined {
  if (!hostname.startsWith("::ffff:")) {
    return undefined;
  }

  const suffix = hostname.slice("::ffff:".length);

  if (isIP(suffix) === 4) {
    return suffix;
  }

  const segments = suffix.split(":");

  if (segments.length !== 2) {
    return undefined;
  }

  const values = segments.map((segment) => Number.parseInt(segment, 16));

  if (
    values.some(
      (value) => Number.isNaN(value) || value < 0 || value > 0xffff
    )
  ) {
    return undefined;
  }

  return [
    values[0] >> 8,
    values[0] & 0xff,
    values[1] >> 8,
    values[1] & 0xff
  ].join(".");
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
