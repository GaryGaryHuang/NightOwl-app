import {
  type PermissionHandler,
  type SessionConfig
} from "@github/copilot-sdk";
import { isIP } from "node:net";
import path from "node:path";

import type { ReviewSessionProfile } from "./review-session-factory.ts";
import type { ToolAuditWriter } from "./tool-audit-writer.ts";
import {
  DefaultWebFetchRedirectResolver,
  DEFAULT_WEB_FETCH_REDIRECT_HOP_LIMIT,
  DEFAULT_WEB_FETCH_REDIRECT_TIMEOUT_MS,
  type WebFetchRedirectResolver
} from "./web-fetch-redirect-resolver.ts";

type PreToolUseHook = NonNullable<
  NonNullable<SessionConfig["hooks"]>["onPreToolUse"]
>;
type PreToolUseHookInput = Parameters<PreToolUseHook>[0];
type PreToolUseHookResult = Awaited<ReturnType<PreToolUseHook>>;

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

export interface ToolPolicyGuardOptions {
  redirectResolver?: WebFetchRedirectResolver;
  webFetchAllowedHosts?: string[];
  webFetchDeniedHosts?: string[];
  webFetchRedirectHopLimit?: number;
  webFetchRedirectTimeoutMs?: number;
}

export class ToolPolicyGuard {
  readonly #redirectResolver: WebFetchRedirectResolver;
  readonly #webFetchAllowedHosts?: Set<string>;
  readonly #webFetchWildcardSuffixes?: readonly string[];
  readonly #webFetchDeniedHosts?: Set<string>;
  readonly #webFetchDeniedWildcardSuffixes?: readonly string[];
  readonly #webFetchRedirectHopLimit: number;
  readonly #webFetchRedirectTimeoutMs: number;

  constructor(options: ToolPolicyGuardOptions) {
    this.#redirectResolver =
      options.redirectResolver ?? new DefaultWebFetchRedirectResolver();
    this.#webFetchRedirectHopLimit =
      options.webFetchRedirectHopLimit ?? DEFAULT_WEB_FETCH_REDIRECT_HOP_LIMIT;
    this.#webFetchRedirectTimeoutMs =
      options.webFetchRedirectTimeoutMs ?? DEFAULT_WEB_FETCH_REDIRECT_TIMEOUT_MS;

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

    if (options.webFetchDeniedHosts === undefined) {
      this.#webFetchDeniedHosts = undefined;
      this.#webFetchDeniedWildcardSuffixes = undefined;
    } else {
      const exactDenied = new Set<string>();
      const deniedWildcardSuffixes: string[] = [];

      for (const host of options.webFetchDeniedHosts) {
        if (host.startsWith("*.")) {
          deniedWildcardSuffixes.push(`.${host.slice(2)}`);
        } else {
          exactDenied.add(canonicalizeHostnameForComparison(host));
        }
      }

      this.#webFetchDeniedHosts = exactDenied;
      this.#webFetchDeniedWildcardSuffixes = deniedWildcardSuffixes;
    }
  }

  buildPermissionHandler(
    profile: Pick<ReviewSessionProfile, "repoRoot" | "outputBaseDir">,
    auditWriter?: ToolAuditWriter
  ): PermissionHandler {
    return async (request) => {
      if (
        request.kind === "read" &&
        typeof request.path === "string" &&
        isAllowedReadPath(request.path, profile)
      ) {
        auditWriter?.append({
          ts: new Date().toISOString(),
          tool: "read",
          decision: "allow",
          args: { path: request.path }
        });

        return { kind: "approved" };
      }

      if (request.kind === "read") {
        const readPath = typeof request.path === "string" ? request.path : undefined;
        const reason = "Read path is outside the allowed boundary.";

        auditWriter?.append({
          ts: new Date().toISOString(),
          tool: "read",
          decision: "deny",
          reason,
          args: readPath !== undefined ? { path: readPath } : {}
        });

        return { kind: "denied-no-approval-rule-and-could-not-request-from-user" };
      }

      if (request.kind === "write") {
        const fileName =
          "fileName" in request && typeof request.fileName === "string"
            ? request.fileName
            : undefined;
        const reason = "Write operations are not permitted in review sessions.";

        auditWriter?.append({
          ts: new Date().toISOString(),
          tool: "write",
          decision: "deny",
          reason,
          args: fileName !== undefined ? { path: fileName } : {}
        });

        return { kind: "denied-no-approval-rule-and-could-not-request-from-user" };
      }

      return { kind: "denied-no-approval-rule-and-could-not-request-from-user" };
    };
  }

  buildPreToolUseHook(
    profile: Pick<ReviewSessionProfile, "repoRoot" | "outputBaseDir">,
    auditWriter?: ToolAuditWriter
  ): PreToolUseHook {
    return async (input: PreToolUseHookInput): Promise<PreToolUseHookResult> => {
      if (input.toolName === "web_fetch") {
        const url =
          input.toolArgs &&
          typeof input.toolArgs === "object" &&
          "url" in input.toolArgs &&
          typeof input.toolArgs.url === "string"
            ? input.toolArgs.url
            : "";

        const parsedUrl = parseAllowedWebFetchUrl(url);
        let decision: PreToolUseHookResult;

        if (!parsedUrl) {
          decision = {
            permissionDecision: "deny",
            permissionDecisionReason:
              "Review sessions only allow web_fetch for absolute public http(s) URLs."
          };
        } else {
          decision = this.evaluateWebFetchHostPolicy(parsedUrl);

          if (!decision) {
            const redirectResolution = await this.#redirectResolver.resolveRedirectChain(
              parsedUrl,
              {
                maxHops: this.#webFetchRedirectHopLimit,
                timeoutMs: this.#webFetchRedirectTimeoutMs,
                validateRedirectTarget: async (redirectTarget) => {
                  const parsedRedirectUrl = parseAllowedWebFetchUrl(
                    redirectTarget.toString()
                  );

                  if (!parsedRedirectUrl) {
                    return "Review sessions only allow web_fetch for absolute public http(s) URLs.";
                  }

                  return this.evaluateWebFetchHostPolicy(parsedRedirectUrl)
                    ?.permissionDecisionReason;
                }
              }
            );

            if (redirectResolution.kind === "denied") {
              decision = {
                permissionDecision: "deny",
                permissionDecisionReason: redirectResolution.reason
              };
            } else {
              for (const redirectUrl of redirectResolution.redirectChain) {
                const parsedRedirectUrl = parseAllowedWebFetchUrl(redirectUrl.toString());

                if (!parsedRedirectUrl) {
                  decision = {
                    permissionDecision: "deny",
                    permissionDecisionReason:
                      "Review sessions only allow web_fetch for absolute public http(s) URLs."
                  };
                  break;
                }

                decision = this.evaluateWebFetchHostPolicy(parsedRedirectUrl);

                if (decision) {
                  break;
                }
              }
            }
          }
        }

        auditWriter?.append({
          ts: new Date().toISOString(),
          tool: "web_fetch",
          decision: decision ? "deny" : "allow",
          ...(decision ? { reason: decision.permissionDecisionReason } : {}),
          args: { url }
        });

        return decision;
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

      const decision: PreToolUseHookResult = isAllowedReadonlyBashCommand(command, profile)
        ? undefined
        : {
            permissionDecision: "deny",
            permissionDecisionReason:
              "Review sessions only allow repo-local read-only bash analysis commands."
          };

      auditWriter?.append({
        ts: new Date().toISOString(),
        tool: "bash",
        decision: decision ? "deny" : "allow",
        ...(decision ? { reason: decision.permissionDecisionReason } : {}),
        args: { command }
      });

      return decision;
    };
  }

  evaluateWebFetchHostPolicy(url: URL): PreToolUseHookResult {
    const normalizedHostname = canonicalizeHostnameForComparison(url.hostname);

    if (this.#webFetchAllowedHosts !== undefined) {
      if (
        !this.#webFetchAllowedHosts.has(normalizedHostname) &&
        !(this.#webFetchWildcardSuffixes ?? []).some((suffix) =>
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

    if (this.#webFetchDeniedHosts !== undefined) {
      return evaluateWebFetchDenyList(
        normalizedHostname,
        this.#webFetchDeniedHosts,
        this.#webFetchDeniedWildcardSuffixes
      );
    }

    return undefined;
  }
}

function evaluateWebFetchDenyList(
  normalizedHostname: string,
  webFetchDeniedHosts: ReadonlySet<string>,
  webFetchDeniedWildcardSuffixes?: readonly string[]
): PreToolUseHookResult {
  if (
    webFetchDeniedHosts.has(normalizedHostname) ||
    (webFetchDeniedWildcardSuffixes ?? []).some((suffix) =>
      normalizedHostname.endsWith(suffix)
    )
  ) {
    return {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow web_fetch for configured public http(s) hosts."
    };
  }

  return undefined;
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
  const trimmedCommand = command.trim();

  if (!trimmedCommand) {
    return false;
  }

  if (/[;&|`><]/u.test(trimmedCommand) || /\$\(/u.test(trimmedCommand)) {
    return false;
  }

  if (!ALLOWED_BASH_PREFIXES.some((prefix) => matchesAllowedBashPrefix(trimmedCommand, prefix))) {
    return false;
  }

  if (containsDangerousFlag(trimmedCommand)) {
    return false;
  }

  return hasOnlyAllowedPathArguments(trimmedCommand, profile);
}

function matchesAllowedBashPrefix(command: string, prefix: string): boolean {
  return command === prefix || command.startsWith(`${prefix} `);
}

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