import assert from "node:assert/strict";

import type { PermissionRequest } from "@github/copilot-sdk";

import { ToolPolicyGuard } from "../../src/services/tool-policy/tool-policy-guard.ts";
import type { ToolPolicyBoundaryContext } from "../../src/services/tool-policy/tool-policy-types.ts";
import { ToolPolicyWebFetchPolicy } from "../../src/services/tool-policy/tool-policy-web-fetch-policy.ts";
import type { ToolAuditRecord, ToolAuditSink } from "../../src/services/tool-audit-writer.ts";
import type {
  WebFetchHostnameClassification,
  WebFetchHostnameClassifier
} from "../../src/services/tool-policy/web-fetch-hostname-classifier.ts";

export const BASE_PROFILE: ToolPolicyBoundaryContext = {
  repoRoot: "/workspace/repo"
};

export interface ExpectedAuditRecord {
  tool: string;
  decision: "allow" | "deny";
  reason?: string;
  args?: Record<string, string | undefined>;
}

export function assertAuditRecord(
  actual: {
    tool: string;
    decision: string;
    reason?: string;
    args: Record<string, string | undefined>;
  },
  expected: ExpectedAuditRecord
): void {
  assert.equal(actual.tool, expected.tool);
  assert.equal(actual.decision, expected.decision);

  if ("reason" in expected) {
    assert.equal(actual.reason, expected.reason);
  }

  if (expected.args !== undefined) {
    assert.deepEqual(actual.args, expected.args);
  }
}

export function createPermissionRequest(
  request: { kind: string } & Record<string, unknown>
): PermissionRequest {
  return request as PermissionRequest;
}

// Returns both the guard instance and its derived hook/handler so tests can
// either invoke the hook directly (simulating the SDK onPreToolUse callback)
// or call the handler (simulating the permission resolution path) as needed.
export function createPolicySession(options?: {
  profile?: ToolPolicyBoundaryContext;
  webFetchAllowedHosts?: string[];
  webFetchDeniedHosts?: string[];
  hostnameClassifier?: WebFetchHostnameClassifier;
  webFetchHostnameClassificationTimeoutMs?: number;
  auditWriter?: ToolAuditSink;
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
    ...(options?.webFetchHostnameClassificationTimeoutMs === undefined
      ? {}
      : {
          webFetchHostnameClassificationTimeoutMs:
            options.webFetchHostnameClassificationTimeoutMs
        }),
  });

  return {
    guard,
    hook: guard.buildPreToolUseHook(options?.profile ?? BASE_PROFILE, options?.auditWriter),
    handler: guard.buildPermissionHandler(options?.profile ?? BASE_PROFILE, options?.auditWriter)
  };
}

export function createWebFetchPolicy(options?: {
  webFetchAllowedHosts?: string[];
  webFetchDeniedHosts?: string[];
  hostnameClassifier?: WebFetchHostnameClassifier;
  webFetchHostnameClassificationTimeoutMs?: number;
}) {
  return new ToolPolicyWebFetchPolicy({
    ...(options?.webFetchAllowedHosts === undefined
      ? {}
      : { webFetchAllowedHosts: options.webFetchAllowedHosts }),
    ...(options?.webFetchDeniedHosts === undefined
      ? {}
      : { webFetchDeniedHosts: options.webFetchDeniedHosts }),
    hostnameClassifier:
      options?.hostnameClassifier ??
      new FakeHostnameClassifier({ kind: "allowed" }),
    ...(options?.webFetchHostnameClassificationTimeoutMs === undefined
      ? {}
      : {
          webFetchHostnameClassificationTimeoutMs:
            options.webFetchHostnameClassificationTimeoutMs
        }),
  });
}

// spy-instrumented test double: records each call and returns a pre-configured
// classification. Accepts a factory function to vary the result per hostname.
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

export class InMemoryAuditSink implements ToolAuditSink {
  readonly records: ToolAuditRecord[] = [];

  append(record: ToolAuditRecord): void {
    this.records.push(record);
  }
}
