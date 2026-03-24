import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import type { ReviewSessionProfile } from "../../src/services/review-session-factory.ts";
import { ToolPolicyGuard } from "../../src/services/tool-policy-guard.ts";
import { ToolAuditWriter } from "../../src/services/tool-audit-writer.ts";
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
  redirectResolver?: WebFetchRedirectResolver;
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
    redirectResolver:
      options?.redirectResolver ??
      new FakeRedirectResolver({ kind: "resolved", redirectChain: [] }),
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
