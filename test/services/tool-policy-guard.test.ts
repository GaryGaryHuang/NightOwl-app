import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { mock } from "node:test";
import test from "node:test";

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

const BASE_PROFILE: Pick<ReviewSessionProfile, "outputBaseDir" | "repoRoot"> = {
  outputBaseDir: "/workspace/repo/packages/app",
  repoRoot: "/workspace/repo"
};

function createPolicySession(options?: {
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

class FakeRedirectResolver implements WebFetchRedirectResolver {
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

class FakeHostnameClassifier implements WebFetchHostnameClassifier {
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

function readAuditLines(auditPath: string): ReturnType<typeof JSON.parse>[] {
  const content = readFileSync(auditPath, "utf8");

  return content
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

test("tool policy baseline allows repo-local reads and denies out-of-bound reads and writes", async () => {
  const { handler } = createPolicySession();

  assert.deepEqual(
    await handler(
      { kind: "read", path: "/workspace/repo/src/app.ts" },
      { sessionId: "session-1" }
    ),
    { kind: "approved" }
  );
  assert.deepEqual(
    await handler(
      { kind: "read", path: "/workspace/repo/packages/app/review/run/files/a.md" },
      { sessionId: "session-1" }
    ),
    { kind: "approved" }
  );
  assert.deepEqual(
    await handler(
      { kind: "read", path: "/tmp/secret.txt" },
      { sessionId: "session-1" }
    ),
    { kind: "denied-no-approval-rule-and-could-not-request-from-user" }
  );
  assert.deepEqual(
    await handler(
      { kind: "write", fileName: "/workspace/repo/src/app.ts" },
      { sessionId: "session-1" }
    ),
    { kind: "denied-no-approval-rule-and-could-not-request-from-user" }
  );
});

test("tool policy baseline enforces web_fetch public-http(s) guard", async () => {
  const { hook } = createPolicySession();

  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "https://docs.example.com/guide" }
      },
      { sessionId: "session-1" }
    ),
    undefined
  );
  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "http://example.com/spec" }
      },
      { sessionId: "session-1" }
    ),
    undefined
  );
  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "/internal/path" }
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow web_fetch for absolute public http(s) URLs."
    }
  );
  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "http://localhost:3000" }
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow web_fetch for absolute public http(s) URLs."
    }
  );
  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "http://192.168.1.10/admin" }
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow web_fetch for absolute public http(s) URLs."
    }
  );
  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "http://[::1]/admin" }
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow web_fetch for absolute public http(s) URLs."
    }
  );
  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "https://" }
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow web_fetch for absolute public http(s) URLs."
    }
  );
  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "file:///etc/passwd" }
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow web_fetch for absolute public http(s) URLs."
    }
  );
  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "http://[::ffff:127.0.0.1]/admin" }
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow web_fetch for absolute public http(s) URLs."
    }
  );
});

test("tool policy baseline applies hostname DNS classification after syntax checks for hostname-based URLs only", async () => {
  const classifier = new FakeHostnameClassifier({ kind: "allowed" });
  const { hook } = createPolicySession({ hostnameClassifier: classifier });

  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "https://docs.example.com/guide" }
      },
      { sessionId: "session-1" }
    ),
    undefined
  );

  assert.deepEqual(classifier.calls, [
    {
      hostname: "docs.example.com",
      timeoutMs: 5000
    }
  ]);

  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "http://192.168.1.10/admin" }
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow web_fetch for absolute public http(s) URLs."
    }
  );

  assert.equal(classifier.calls.length, 1);
});

test("tool policy baseline denies hostname DNS classification failures with a stable reason", async () => {
  const classifier = new FakeHostnameClassifier({
    kind: "denied",
    reason:
      "Review sessions only allow web_fetch for hostnames that resolve to public network addresses."
  });
  const { hook } = createPolicySession({ hostnameClassifier: classifier });

  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "https://internal-proxy.example.com/admin" }
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow web_fetch for hostnames that resolve to public network addresses."
    }
  );
});

test("tool policy baseline enforces readonly bash commands and path boundaries", async () => {
  const { hook } = createPolicySession();

  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: "git diff main...feature-branch --name-status" }
      },
      { sessionId: "session-1" }
    ),
    undefined
  );
  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: "curl https://example.com" }
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow repo-local read-only bash analysis commands."
    }
  );
  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: "ls" }
      },
      { sessionId: "session-1" }
    ),
    undefined
  );
  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: "sort" }
      },
      { sessionId: "session-1" }
    ),
    undefined
  );
  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: "uniq" }
      },
      { sessionId: "session-1" }
    ),
    undefined
  );
  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: "lsof" }
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow repo-local read-only bash analysis commands."
    }
  );
  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: "sorting" }
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow repo-local read-only bash analysis commands."
    }
  );
  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: "git diffmain...feature-branch" }
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow repo-local read-only bash analysis commands."
    }
  );
  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: "cat ../secret.txt" }
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow repo-local read-only bash analysis commands."
    }
  );
  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: "cat /etc/passwd" }
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow repo-local read-only bash analysis commands."
    }
  );
  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: "git checkout main" }
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow repo-local read-only bash analysis commands."
    }
  );
  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: "git log; rm -rf /" }
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow repo-local read-only bash analysis commands."
    }
  );
  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: "git diff --output=/tmp/out main...feature-branch" }
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow repo-local read-only bash analysis commands."
    }
  );
});

test("tool policy baseline passes through non-bash and non-web_fetch tools and handles missing toolArgs conservatively", async () => {
  const { hook } = createPolicySession();

  assert.equal(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "view",
        toolArgs: { file: "src/app.ts" }
      },
      { sessionId: "session-1" }
    ),
    undefined
  );
  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: undefined
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow repo-local read-only bash analysis commands."
    }
  );
  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: undefined
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow web_fetch for absolute public http(s) URLs."
    }
  );
  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: "https://docs.example.com" as unknown as Record<string, unknown>
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow web_fetch for absolute public http(s) URLs."
    }
  );
});

test("tool policy baseline enforces exact-host web_fetch allowlist", async () => {
  const { hook } = createPolicySession({
    webFetchAllowedHosts: ["docs.example.com"]
  });

  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "https://docs.example.com/guide" }
      },
      { sessionId: "session-1" }
    ),
    undefined
  );
  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "https://Docs.Example.Com/reference" }
      },
      { sessionId: "session-1" }
    ),
    undefined
  );
  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "https://docs.example.com./guide" }
      },
      { sessionId: "session-1" }
    ),
    undefined
  );
  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "https://docs.example.com:8443/guide" }
      },
      { sessionId: "session-1" }
    ),
    undefined
  );
  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "https://react.dev/reference" }
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow web_fetch for configured public http(s) hosts."
    }
  );
});

test("tool policy baseline denies all web_fetch hosts when allowlist is empty", async () => {
  const { hook } = createPolicySession({ webFetchAllowedHosts: [] });

  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "https://docs.example.com/guide" }
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow web_fetch for configured public http(s) hosts."
    }
  );
});

test("tool policy baseline enforces wildcard and mixed allowlist semantics", async () => {
  const wildcard = createPolicySession({
    webFetchAllowedHosts: ["*.example.com"]
  });

  assert.deepEqual(
    await wildcard.hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "https://docs.example.com/guide" }
      },
      { sessionId: "session-1" }
    ),
    undefined
  );
  assert.deepEqual(
    await wildcard.hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "https://api.docs.example.com/v2/ref" }
      },
      { sessionId: "session-1" }
    ),
    undefined
  );
  assert.deepEqual(
    await wildcard.hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "https://example.com/guide" }
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow web_fetch for configured public http(s) hosts."
    }
  );

  const mixed = createPolicySession({
    webFetchAllowedHosts: ["react.dev", "*.example.com"]
  });

  assert.deepEqual(
    await mixed.hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "https://react.dev/reference" }
      },
      { sessionId: "session-1" }
    ),
    undefined
  );
  assert.deepEqual(
    await mixed.hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "https://docs.example.com/guide" }
      },
      { sessionId: "session-1" }
    ),
    undefined
  );
  assert.deepEqual(
    await mixed.hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "https://vuejs.org/guide" }
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow web_fetch for configured public http(s) hosts."
    }
  );
});

test("tool policy baseline enforces denylist semantics over allowlist", async () => {
  const exact = createPolicySession({
    webFetchAllowedHosts: ["*.example.com"],
    webFetchDeniedHosts: ["internal.example.com"]
  });

  assert.deepEqual(
    await exact.hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "https://internal.example.com/admin" }
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow web_fetch for configured public http(s) hosts."
    }
  );
  assert.deepEqual(
    await exact.hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "https://docs.example.com/guide" }
      },
      { sessionId: "session-1" }
    ),
    undefined
  );

  const wildcard = createPolicySession({
    webFetchAllowedHosts: ["*.example.com"],
    webFetchDeniedHosts: ["*.internal.example.com"]
  });

  assert.deepEqual(
    await wildcard.hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "https://api.internal.example.com/v2" }
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow web_fetch for configured public http(s) hosts."
    }
  );
  assert.deepEqual(
    await wildcard.hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "https://internal.example.com/page" }
      },
      { sessionId: "session-1" }
    ),
    undefined
  );
});

test("tool policy baseline validates redirect chains after the initial URL passes baseline policy", async () => {
  const redirectResolver = new FakeRedirectResolver({
    kind: "resolved",
    redirectChain: [new URL("https://reference.example.net/page")]
  });
  const { hook } = createPolicySession({ redirectResolver });

  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "https://docs.example.com/start" }
      },
      { sessionId: "session-1" }
    ),
    undefined
  );
  assert.deepEqual(redirectResolver.calls, [
    {
      initialUrl: "https://docs.example.com/start",
      maxHops: 5,
      timeoutMs: 5000,
      validateRedirectTarget: true
    }
  ]);
});

test("tool policy baseline denies the initial URL before redirect traversal when initial host policy fails", async () => {
  const redirectResolver = new FakeRedirectResolver({
    kind: "resolved",
    redirectChain: [new URL("https://docs.example.com/guide")]
  });
  const { hook } = createPolicySession({
    webFetchAllowedHosts: ["docs.example.com"],
    redirectResolver
  });

  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "https://reference.example.net/start" }
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow web_fetch for configured public http(s) hosts."
    }
  );
  assert.equal(redirectResolver.calls.length, 0);
});

test("tool policy baseline short-circuits host-policy denials before DNS classification", async () => {
  const classifier = new FakeHostnameClassifier({ kind: "allowed" });
  const { hook } = createPolicySession({
    webFetchAllowedHosts: ["docs.example.com"],
    hostnameClassifier: classifier,
    redirectResolver: new FakeRedirectResolver({
      kind: "resolved",
      redirectChain: [new URL("https://docs.example.com/guide")]
    })
  });

  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "https://react.dev/reference" }
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow web_fetch for configured public http(s) hosts."
    }
  );

  assert.equal(classifier.calls.length, 0);
});

test("tool policy baseline enforces allowlist and denylist semantics across redirect targets", async () => {
  const allowlistMiss = createPolicySession({
    webFetchAllowedHosts: ["docs.example.com"],
    redirectResolver: new FakeRedirectResolver({
      kind: "resolved",
      redirectChain: [new URL("https://reference.example.net/page")]
    })
  });

  assert.deepEqual(
    await allowlistMiss.hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "https://docs.example.com/start" }
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow web_fetch for configured public http(s) hosts."
    }
  );

  const wildcardAllow = createPolicySession({
    webFetchAllowedHosts: ["*.example.com"],
    redirectResolver: new FakeRedirectResolver({
      kind: "resolved",
      redirectChain: [new URL("https://api.docs.example.com/reference")]
    })
  });

  assert.deepEqual(
    await wildcardAllow.hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "https://docs.example.com/start" }
      },
      { sessionId: "session-1" }
    ),
    undefined
  );

  const denylistHit = createPolicySession({
    webFetchAllowedHosts: ["*.example.com"],
    webFetchDeniedHosts: ["internal.example.com"],
    redirectResolver: new FakeRedirectResolver({
      kind: "resolved",
      redirectChain: [new URL("https://internal.example.com/admin")]
    })
  });

  assert.deepEqual(
    await denylistHit.hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "https://docs.example.com/start" }
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow web_fetch for configured public http(s) hosts."
    }
  );
});

test("tool policy baseline enforces DNS classification across redirect targets", async () => {
  const classifier = new FakeHostnameClassifier(async (hostname) =>
    hostname === "internal-proxy.example.com"
      ? {
          kind: "denied",
          reason:
            "Review sessions only allow web_fetch for hostnames that resolve to public network addresses."
        }
      : { kind: "allowed" }
  );
  const { hook } = createPolicySession({
    hostnameClassifier: classifier,
    redirectResolver: new FakeRedirectResolver({
      kind: "resolved",
      redirectChain: [new URL("https://internal-proxy.example.com/admin")]
    })
  });

  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "https://docs.example.com/start" }
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow web_fetch for hostnames that resolve to public network addresses."
    }
  );
});

test("tool policy baseline memoizes hostname DNS classification within one decision using canonical hostnames", async () => {
  const classifier = new FakeHostnameClassifier({ kind: "allowed" });
  const { hook } = createPolicySession({
    hostnameClassifier: classifier,
    redirectResolver: new FakeRedirectResolver({
      kind: "resolved",
      redirectChain: [new URL("https://Docs.Example.Com./reference")]
    })
  });

  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "https://docs.example.com/start" }
      },
      { sessionId: "session-1" }
    ),
    undefined
  );

  assert.deepEqual(classifier.calls, [
    {
      hostname: "docs.example.com",
      timeoutMs: 5000
    }
  ]);
});

test("tool policy baseline denies unresolved redirect chains conservatively", async () => {
  const redirectResolver = new FakeRedirectResolver({
    kind: "denied",
    reason: "Review sessions only allow web_fetch when redirect chains resolve safely."
  });
  const { hook } = createPolicySession({ redirectResolver });

  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "https://docs.example.com/start" }
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow web_fetch when redirect chains resolve safely."
    }
  );
});

test("tool policy baseline enforces denylist comparison and denylist-only semantics", async () => {
  const denylist = createPolicySession({
    webFetchAllowedHosts: ["*.example.com"],
    webFetchDeniedHosts: ["internal.example.com"]
  });

  assert.deepEqual(
    await denylist.hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "https://INTERNAL.example.com/admin" }
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow web_fetch for configured public http(s) hosts."
    }
  );
  assert.deepEqual(
    await denylist.hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "https://internal.example.com./admin" }
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow web_fetch for configured public http(s) hosts."
    }
  );
  assert.deepEqual(
    await denylist.hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "https://internal.example.com:8443/admin" }
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow web_fetch for configured public http(s) hosts."
    }
  );

  const denyOnly = createPolicySession({
    webFetchDeniedHosts: ["evil.com"]
  });

  assert.deepEqual(
    await denyOnly.hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "https://evil.com/payload" }
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow web_fetch for configured public http(s) hosts."
    }
  );
  assert.deepEqual(
    await denyOnly.hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "https://docs.example.com/guide" }
      },
      { sessionId: "session-1" }
    ),
    undefined
  );

  const denyOnlyWildcard = createPolicySession({
    webFetchDeniedHosts: ["*.evil.com"]
  });

  assert.deepEqual(
    await denyOnlyWildcard.hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "https://sub.evil.com/payload" }
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow web_fetch for configured public http(s) hosts."
    }
  );
  assert.deepEqual(
    await denyOnlyWildcard.hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "https://evil.com/payload" }
      },
      { sessionId: "session-1" }
    ),
    undefined
  );
});

test("tool policy baseline handles empty and mixed denylist combinations", async () => {
  const emptyDenylist = createPolicySession({
    webFetchAllowedHosts: ["*.example.com"],
    webFetchDeniedHosts: []
  });

  assert.deepEqual(
    await emptyDenylist.hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "https://internal.example.com/admin" }
      },
      { sessionId: "session-1" }
    ),
    undefined
  );

  const mixed = createPolicySession({
    webFetchAllowedHosts: ["*.example.com", "evil.org"],
    webFetchDeniedHosts: ["internal.example.com", "*.secret.example.com"]
  });

  assert.deepEqual(
    await mixed.hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "https://api.secret.example.com/data" }
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow web_fetch for configured public http(s) hosts."
    }
  );

  const sameHost = createPolicySession({
    webFetchAllowedHosts: ["internal.example.com"],
    webFetchDeniedHosts: ["internal.example.com"]
  });

  assert.deepEqual(
    await sameHost.hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "https://internal.example.com/admin" }
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow web_fetch for configured public http(s) hosts."
    }
  );
});

test("tool policy baseline writes audit records for pre-tool decisions", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "nightowl-audit-"));

  try {
    const auditPath = path.join(tempDir, "tool-audit.jsonl");
    const auditWriter = new ToolAuditWriter(auditPath);
    const { hook } = createPolicySession({ auditWriter });

    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: "git log --oneline -5" }
      },
      { sessionId: "s1" }
    );
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "http://localhost:8080" }
      },
      { sessionId: "s1" }
    );

    const [allowRecord, denyRecord] = readAuditLines(auditPath);

    assert.equal(allowRecord.tool, "bash");
    assert.equal(allowRecord.decision, "allow");
    assert.equal(allowRecord.args.command, "git log --oneline -5");
    assert.equal("reason" in allowRecord, false);
    assert.equal(denyRecord.tool, "web_fetch");
    assert.equal(denyRecord.decision, "deny");
    assert.equal(denyRecord.args.url, "http://localhost:8080");
    assert.ok(typeof denyRecord.reason === "string" && denyRecord.reason.length > 0);
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("tool policy baseline writes audit records for redirect-policy denials", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "nightowl-audit-"));

  try {
    const auditPath = path.join(tempDir, "tool-audit.jsonl");
    const auditWriter = new ToolAuditWriter(auditPath);
    const { hook } = createPolicySession({
      auditWriter,
      redirectResolver: new FakeRedirectResolver({
        kind: "denied",
        reason: "Review sessions only allow web_fetch when redirect chains resolve safely."
      })
    });

    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "https://docs.example.com/start" }
      },
      { sessionId: "s1" }
    );

    const [denyRecord] = readAuditLines(auditPath);

    assert.equal(denyRecord.tool, "web_fetch");
    assert.equal(denyRecord.decision, "deny");
    assert.equal(denyRecord.args.url, "https://docs.example.com/start");
    assert.equal(
      denyRecord.reason,
      "Review sessions only allow web_fetch when redirect chains resolve safely."
    );
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("tool policy baseline writes audit records for permission decisions", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "nightowl-audit-"));

  try {
    const auditPath = path.join(tempDir, "tool-audit.jsonl");
    const auditWriter = new ToolAuditWriter(auditPath);
    const { handler } = createPolicySession({ auditWriter });

    await handler(
      { kind: "read", path: "/workspace/repo/src/app.ts" },
      { sessionId: "s1" }
    );
    await handler(
      { kind: "read", path: "/tmp/secret.txt" },
      { sessionId: "s1" }
    );
    await handler(
      { kind: "write", fileName: "/workspace/repo/src/app.ts" },
      { sessionId: "s1" }
    );
    await handler(
      { kind: "write" } as Parameters<typeof handler>[0],
      { sessionId: "s1" }
    );

    const [readAllow, readDeny, writeDeny, writeDenyNoFile] = readAuditLines(auditPath);

    assert.equal(readAllow.tool, "read");
    assert.equal(readAllow.decision, "allow");
    assert.equal(readDeny.tool, "read");
    assert.equal(readDeny.decision, "deny");
    assert.equal(readDeny.reason, "Read path is outside the allowed boundary.");
    assert.equal(writeDeny.tool, "write");
    assert.equal(writeDeny.decision, "deny");
    assert.equal(
      writeDeny.reason,
      "Write operations are not permitted in review sessions."
    );
    assert.deepEqual(writeDenyNoFile.args, {});
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("tool policy baseline behaves normally without an audit writer", async () => {
  const { hook, handler } = createPolicySession();

  assert.equal(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: "git log" }
      },
      { sessionId: "s1" }
    ),
    undefined
  );
  assert.deepEqual(
    await handler(
      { kind: "read", path: "/workspace/repo/src/app.ts" },
      { sessionId: "s1" }
    ),
    { kind: "approved" }
  );
});

// Pipeline exception tests (Tasks 1.1 + 1.3)

test("tool policy bash pipeline allows two-segment pipeline with whitelisted commands", async () => {
  // (a) simple two-segment pipeline
  const { hook } = createPolicySession();

  assert.equal(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: "git log --oneline | head -20" }
      },
      { sessionId: "s1" }
    ),
    undefined
  );
});

test("tool policy bash pipeline allows three-segment pipeline with whitelisted commands", async () => {
  // (b) three-segment pipeline
  const { hook } = createPolicySession();

  assert.equal(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: 'git diff HEAD~1 | grep "function" | wc -l' }
      },
      { sessionId: "s1" }
    ),
    undefined
  );
});

test("tool policy bash pipeline allows pipeline with extra whitespace around pipe operators", async () => {
  // (c) extra whitespace around pipes
  const { hook } = createPolicySession();

  assert.equal(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: "git log --oneline  |  head -20" }
      },
      { sessionId: "s1" }
    ),
    undefined
  );
});

test("tool policy bash pipeline allows pipeline with no whitespace around pipe operator", async () => {
  // (d) no whitespace around pipe
  const { hook } = createPolicySession();

  assert.equal(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: "git log|head" }
      },
      { sessionId: "s1" }
    ),
    undefined
  );
});

test("tool policy bash pipeline denies pipeline where one segment is not whitelisted", async () => {
  // (e) non-whitelisted segment
  const { hook } = createPolicySession();

  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: "git log --oneline | curl http://example.com" }
      },
      { sessionId: "s1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow repo-local read-only bash analysis commands."
    }
  );
});

test("tool policy bash pipeline denies pipeline where one segment has a path outside the allowed boundary", async () => {
  // (f) out-of-boundary path in segment
  const { hook } = createPolicySession();

  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: "cat /etc/passwd | head -5" }
      },
      { sessionId: "s1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow repo-local read-only bash analysis commands."
    }
  );
});

test("tool policy bash pipeline denies pipeline where one segment has a dangerous flag", async () => {
  // (g) dangerous flag in segment
  const { hook } = createPolicySession();

  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: "git log --oneline | sort --output=result.txt" }
      },
      { sessionId: "s1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow repo-local read-only bash analysis commands."
    }
  );
});

test("tool policy bash pipeline denies pipeline with empty segment from trailing pipe", async () => {
  // (h) trailing pipe produces empty segment
  const { hook } = createPolicySession();

  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: "git log |" }
      },
      { sessionId: "s1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow repo-local read-only bash analysis commands."
    }
  );
});

test("tool policy bash pipeline denies pipeline with empty segment from leading pipe", async () => {
  // (i) leading pipe produces empty segment
  const { hook } = createPolicySession();

  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: "| head -5" }
      },
      { sessionId: "s1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow repo-local read-only bash analysis commands."
    }
  );
});

test("tool policy bash pipeline denies pipeline with only whitespace segment", async () => {
  // (j) whitespace-only middle segment
  const { hook } = createPolicySession();

  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: "git log |   | head" }
      },
      { sessionId: "s1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow repo-local read-only bash analysis commands."
    }
  );
});

test("tool policy bash pipeline denies logical OR syntax", async () => {
  // (k) || logical OR
  const { hook } = createPolicySession();

  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: "git status || echo fail" }
      },
      { sessionId: "s1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow repo-local read-only bash analysis commands."
    }
  );
});

test("tool policy bash pipeline denies logical OR mixed with pipeline", async () => {
  // (l) || mixed with pipeline
  const { hook } = createPolicySession();

  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: "git log || true | head" }
      },
      { sessionId: "s1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow repo-local read-only bash analysis commands."
    }
  );
});

test("tool policy bash pipeline allows double-quoted regex alternation containing literal pipe", async () => {
  const { hook } = createPolicySession();

  assert.equal(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: 'grep -E "foo|bar"' }
      },
      { sessionId: "s1" }
    ),
    undefined
  );
});

test("tool policy bash pipeline allows single-quoted regex alternation containing literal pipe", async () => {
  const { hook } = createPolicySession();

  assert.equal(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: "grep -E 'foo|bar'" }
      },
      { sessionId: "s1" }
    ),
    undefined
  );
});

test("tool policy bash pipeline allows escaped literal pipe within one segment", async () => {
  const { hook } = createPolicySession();

  assert.equal(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: String.raw`grep foo\|bar` }
      },
      { sessionId: "s1" }
    ),
    undefined
  );
});

test("tool policy bash pipeline allows quoted literal pipe alongside a real top-level pipeline separator", async () => {
  const { hook } = createPolicySession();

  assert.equal(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: 'git diff HEAD~1 | grep -E "foo|bar" | head -5' }
      },
      { sessionId: "s1" }
    ),
    undefined
  );
});

test("tool policy bash pipeline allows repo-relative path token when tool cwd is repo root", async () => {
  const { hook } = createPolicySession();

  assert.equal(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: 'grep -E "foo|bar" src/file.ts' }
      },
      { sessionId: "s1" }
    ),
    undefined
  );
});

test("tool policy bash pipeline denies repo-relative path token when tool cwd is outside allowed boundary", async () => {
  const { hook } = createPolicySession();

  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/tmp",
        toolName: "bash",
        toolArgs: { command: 'grep -E "foo|bar" src/file.ts' }
      },
      { sessionId: "s1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow repo-local read-only bash analysis commands."
    }
  );
});

test("tool policy bash pipeline denies unterminated double quote conservatively", async () => {
  const { hook } = createPolicySession();

  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: 'grep -E "foo|bar' }
      },
      { sessionId: "s1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow repo-local read-only bash analysis commands."
    }
  );
});

test("tool policy bash pipeline denies unterminated single quote conservatively", async () => {
  const { hook } = createPolicySession();

  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: "grep -E 'foo|bar" }
      },
      { sessionId: "s1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow repo-local read-only bash analysis commands."
    }
  );
});

test("tool policy bash pipeline denies dangling escape at end of command conservatively", async () => {
  const { hook } = createPolicySession();

  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: "grep foo\\" }
      },
      { sessionId: "s1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow repo-local read-only bash analysis commands."
    }
  );
});

test("tool policy bash pipeline keeps quoted double-pipe denied as unchanged lexical guardrail", async () => {
  const { hook } = createPolicySession();

  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: 'grep "foo||bar"' }
      },
      { sessionId: "s1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow repo-local read-only bash analysis commands."
    }
  );
});

test("tool policy bash pipeline writes correct audit records for quoted and denied commands", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "nightowl-audit-pipeline-"));

  try {
    const auditPath = path.join(tempDir, "tool-audit.jsonl");
    const auditWriter = new ToolAuditWriter(auditPath);
    const { hook } = createPolicySession({ auditWriter });

    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: 'git diff HEAD~1 | grep -E "foo|bar" | head -5' }
      },
      { sessionId: "s1" }
    );
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: 'grep "foo||bar"' }
      },
      { sessionId: "s1" }
    );

    const [allowRecord, denyRecord] = readAuditLines(auditPath);

    assert.equal(allowRecord.tool, "bash");
    assert.equal(allowRecord.decision, "allow");
    assert.equal(allowRecord.args.command, 'git diff HEAD~1 | grep -E "foo|bar" | head -5');
    assert.equal("reason" in allowRecord, false);

    assert.equal(denyRecord.tool, "bash");
    assert.equal(denyRecord.decision, "deny");
    assert.equal(
      denyRecord.reason,
      "Review sessions only allow repo-local read-only bash analysis commands."
    );
    assert.equal(denyRecord.args.command, 'grep "foo||bar"');
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});

// ─── shell tool name compatibility (tasks 1.4–1.12) ─────────────────────────

test("tool policy shell name 'sh' with allowed command is allowed", async () => {
  const { hook } = createPolicySession();

  assert.equal(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "sh",
        toolArgs: { command: "git log --oneline" }
      },
      { sessionId: "s1" }
    ),
    undefined
  );
});

test("tool policy shell name 'shell' with allowed command is allowed", async () => {
  const { hook } = createPolicySession();

  assert.equal(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "shell",
        toolArgs: { command: "git log --oneline" }
      },
      { sessionId: "s1" }
    ),
    undefined
  );
});

test("tool policy shell name 'sh' with disallowed command is denied", async () => {
  const { hook } = createPolicySession();

  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "sh",
        toolArgs: { command: "rm -rf /" }
      },
      { sessionId: "s1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow repo-local read-only bash analysis commands."
    }
  );
});

test("tool policy shell name 'shell' with disallowed command is denied", async () => {
  const { hook } = createPolicySession();

  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "shell",
        toolArgs: { command: "curl http://example.com" }
      },
      { sessionId: "s1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow repo-local read-only bash analysis commands."
    }
  );
});

test("tool policy shell name 'sh' with pipeline command applies pipeline validation", async () => {
  const { hook } = createPolicySession();

  assert.equal(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "sh",
        toolArgs: { command: "git log --oneline | head -5" }
      },
      { sessionId: "s1" }
    ),
    undefined
  );
});

test("tool policy shell name 'sh' with missing toolArgs is denied", async () => {
  const { hook } = createPolicySession();

  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "sh",
        toolArgs: undefined
      },
      { sessionId: "s1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow repo-local read-only bash analysis commands."
    }
  );
});

test("tool policy shell name 'shell' with missing toolArgs is denied", async () => {
  const { hook } = createPolicySession();

  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "shell",
        toolArgs: undefined
      },
      { sessionId: "s1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow repo-local read-only bash analysis commands."
    }
  );
});

test("tool policy shell name 'sh' and 'shell' audit records use actual toolName", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "nightowl-audit-shell-names-"));

  try {
    const auditPath = path.join(tempDir, "tool-audit.jsonl");
    const auditWriter = new ToolAuditWriter(auditPath);
    const { hook } = createPolicySession({ auditWriter });

    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "sh",
        toolArgs: { command: "git log --oneline" }
      },
      { sessionId: "s1" }
    );
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "shell",
        toolArgs: { command: "rm -rf /" }
      },
      { sessionId: "s1" }
    );

    const [shRecord, shellRecord] = readAuditLines(auditPath);

    assert.equal(shRecord.tool, "sh");
    assert.equal(shRecord.decision, "allow");
    assert.equal(shRecord.args.command, "git log --oneline");

    assert.equal(shellRecord.tool, "shell");
    assert.equal(shellRecord.decision, "deny");
    assert.equal(shellRecord.args.command, "rm -rf /");
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("tool policy unknown toolName like 'python' is not subject to shell policy", async () => {
  const { hook } = createPolicySession();

  assert.equal(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "python",
        toolArgs: { command: "import os; os.system('rm -rf /')" }
      },
      { sessionId: "s1" }
    ),
    undefined
  );
});

// ─── shell policy fail-closed error boundary (tasks 2.4–2.9) ────────────────

test("tool policy fail-closed: policy evaluation throwing an Error returns stable deny", async () => {
  const { hook } = createPolicySession();

  // Simulate isAllowedReadonlyBashCommand throwing by making path.resolve throw
  mock.method(path, "resolve", () => {
    throw new Error("simulated path.resolve failure");
  });

  try {
    assert.deepEqual(
      await hook(
        {
          timestamp: Date.now(),
          cwd: "/workspace/repo",
          toolName: "bash",
          toolArgs: { command: "git log /workspace/repo" }
        },
        { sessionId: "s1" }
      ),
      {
        permissionDecision: "deny",
        permissionDecisionReason:
          "Shell policy evaluation failed; denied as a precaution."
      }
    );
  } finally {
    mock.restoreAll();
  }
});

test("tool policy fail-closed: policy evaluation throwing a non-Error value returns stable deny", async () => {
  const { hook } = createPolicySession();

  mock.method(path, "resolve", () => {
    // eslint-disable-next-line @typescript-eslint/no-throw-literal
    throw "non-error string thrown";
  });

  try {
    assert.deepEqual(
      await hook(
        {
          timestamp: Date.now(),
          cwd: "/workspace/repo",
          toolName: "bash",
          toolArgs: { command: "git log /workspace/repo" }
        },
        { sessionId: "s1" }
      ),
      {
        permissionDecision: "deny",
        permissionDecisionReason:
          "Shell policy evaluation failed; denied as a precaution."
      }
    );
  } finally {
    mock.restoreAll();
  }
});

test("tool policy fail-closed: deny audit record has correct fields when throw occurs after extraction", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "nightowl-audit-failclosed-"));

  try {
    const auditPath = path.join(tempDir, "tool-audit.jsonl");
    const auditWriter = new ToolAuditWriter(auditPath);
    const { hook } = createPolicySession({ auditWriter });

    mock.method(path, "resolve", () => {
      throw new Error("simulated path.resolve failure");
    });

    try {
      await hook(
        {
          timestamp: Date.now(),
          cwd: "/workspace/repo",
          toolName: "bash",
          toolArgs: { command: "git log /workspace/repo" }
        },
        { sessionId: "s1" }
      );
    } finally {
      mock.restoreAll();
    }

    const [record] = readAuditLines(auditPath);

    assert.equal(record.tool, "bash");
    assert.equal(record.decision, "deny");
    assert.equal(
      record.reason,
      "Shell policy evaluation failed; denied as a precaution."
    );
    // command was successfully extracted before path.resolve threw
    assert.equal(record.args.command, "git log /workspace/repo");
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("tool policy fail-closed: deny audit record has empty command when extraction itself throws", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "nightowl-audit-failclosed-extract-"));

  try {
    const auditPath = path.join(tempDir, "tool-audit.jsonl");
    const auditWriter = new ToolAuditWriter(auditPath);
    const { hook } = createPolicySession({ auditWriter });

    // Proxy whose `has` trap throws — triggers throw during `"command" in input.toolArgs`
    const throwingProxy = new Proxy({} as Record<string, unknown>, {
      has(): never {
        throw new Error("has trap throws");
      }
    });

    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: throwingProxy
      },
      { sessionId: "s1" }
    );

    const [record] = readAuditLines(auditPath);

    assert.equal(record.tool, "bash");
    assert.equal(record.decision, "deny");
    assert.equal(
      record.reason,
      "Shell policy evaluation failed; denied as a precaution."
    );
    assert.equal(record.args.command, "");
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("tool policy fail-closed: normal deny does not use fail-closed reason", async () => {
  const { hook } = createPolicySession();

  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: "curl http://example.com" }
      },
      { sessionId: "s1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow repo-local read-only bash analysis commands."
    }
  );
});

test("tool policy fail-closed: web_fetch tool call is unaffected by shell fail-closed boundary", async () => {
  const { hook } = createPolicySession();

  assert.equal(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "https://docs.example.com/guide" }
      },
      { sessionId: "s1" }
    ),
    undefined
  );

  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "http://localhost:3000" }
      },
      { sessionId: "s1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow web_fetch for absolute public http(s) URLs."
    }
  );
});
