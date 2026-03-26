import { readFileSync } from "node:fs";

import type { ReviewSessionProfile } from "../../src/services/review-session-factory.ts";
import { ToolPolicyGuard } from "../../src/services/tool-policy-guard.ts";
import { ToolAuditWriter } from "../../src/services/tool-audit-writer.ts";
import type {
  WebFetchHostnameClassification,
  WebFetchHostnameClassifier
} from "../../src/services/web-fetch-hostname-classifier.ts";
import type {
  WebFetchRedirectResolution,
  WebFetchRedirectResolver
} from "../../src/services/web-fetch-redirect-resolver.ts";

export const BASE_PROFILE: Pick<ReviewSessionProfile, "outputBaseDir" | "repoRoot"> = {
  outputBaseDir: "/workspace/repo/packages/app",
  repoRoot: "/workspace/repo"
};

export function createPolicySession(options?: {
  webFetchAllowedHosts?: string[];
  webFetchDeniedHosts?: string[];
  hostnameClassifier?: WebFetchHostnameClassifier;
  redirectResolver?: WebFetchRedirectResolver;
  webFetchHostnameClassificationTimeoutMs?: number;
  webFetchRedirectHopLimit?: number;
  webFetchRedirectTimeoutMs?: number;
  auditWriter?: ToolAuditWriter;
}) {
  const guard = new ToolPolicyGuard({
    ...(options?.webFetchAllowedHosts === undefined
      ? {}
      : { webFetchAllowedHosts: options.webFetchAllowedHosts }),
    ...(options?.webFetchDeniedHosts === undefined
      ? {}
      : { webFetchDeniedHosts: options.webFetchDeniedHosts }),
    hostnameClassifier:
      options?.hostnameClassifier ??
      new FakeHostnameClassifier({ kind: "allowed" }),
    redirectResolver:
      options?.redirectResolver ??
      new FakeRedirectResolver({ kind: "resolved", redirectChain: [] }),
    ...(options?.webFetchHostnameClassificationTimeoutMs === undefined
      ? {}
      : {
          webFetchHostnameClassificationTimeoutMs:
            options.webFetchHostnameClassificationTimeoutMs
        }),
    ...(options?.webFetchRedirectHopLimit === undefined
      ? {}
      : { webFetchRedirectHopLimit: options.webFetchRedirectHopLimit }),
    ...(options?.webFetchRedirectTimeoutMs === undefined
      ? {}
      : { webFetchRedirectTimeoutMs: options.webFetchRedirectTimeoutMs })
  });

  return {
    guard,
    hook: guard.buildPreToolUseHook(BASE_PROFILE, options?.auditWriter),
    handler: guard.buildPermissionHandler(BASE_PROFILE, options?.auditWriter)
  };
}

export class FakeRedirectResolver implements WebFetchRedirectResolver {
  readonly calls: Array<{
    initialUrl: string;
    maxHops: number;
    timeoutMs: number;
    validateRedirectTarget: boolean;
  }> = [];

  #nextResolution:
    | WebFetchRedirectResolution
    | (() => Promise<WebFetchRedirectResolution>);

  constructor(
    resolution:
      | WebFetchRedirectResolution
      | (() => Promise<WebFetchRedirectResolution>)
  ) {
    this.#nextResolution = resolution;
  }

  async resolveRedirectChain(
    initialUrl: URL,
    options: {
      maxHops: number;
      timeoutMs: number;
      validateRedirectTarget?: (redirectTarget: URL) => string | Promise<string | undefined> | undefined;
    }
  ): Promise<WebFetchRedirectResolution> {
    this.calls.push({
      initialUrl: initialUrl.toString(),
      maxHops: options.maxHops,
      timeoutMs: options.timeoutMs,
      validateRedirectTarget: options.validateRedirectTarget !== undefined
    });

    if (typeof this.#nextResolution === "function") {
      return this.#nextResolution();
    }

    return this.#nextResolution;
  }
}

export class FakeHostnameClassifier implements WebFetchHostnameClassifier {
  readonly calls: Array<{
    hostname: string;
    timeoutMs: number;
  }> = [];

  #nextResult:
    | WebFetchHostnameClassification
    | ((hostname: string) => Promise<WebFetchHostnameClassification>);

  constructor(
    result:
      | WebFetchHostnameClassification
      | ((hostname: string) => Promise<WebFetchHostnameClassification>)
  ) {
    this.#nextResult = result;
  }

  async classifyHostname(
    hostname: string,
    options: { timeoutMs: number }
  ): Promise<WebFetchHostnameClassification> {
    this.calls.push({ hostname, timeoutMs: options.timeoutMs });

    if (typeof this.#nextResult === "function") {
      return this.#nextResult(hostname);
    }

    return this.#nextResult;
  }
}

export function readAuditLines(auditPath: string): ReturnType<typeof JSON.parse>[] {
  const content = readFileSync(auditPath, "utf8");

  return content
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}
