import assert from "node:assert/strict";
import test from "node:test";

import {
  CONFIGURED_WEB_FETCH_HOST_REASON,
  ToolPolicyWebFetchPolicy,
  UNSAFE_WEB_FETCH_URL_REASON
} from "../../src/services/tool-policy-web-fetch-policy.ts";
import {
  createWebFetchPolicy,
  FakeHostnameClassifier,
  FakeRedirectResolver
} from "../helpers/tool-policy-fixture.ts";

test("tool policy web-fetch policy enforces the public http(s) URL gate", async () => {
  const policy = createWebFetchPolicy();

  assert.equal(await policy.evaluate("https://docs.example.com/guide"), undefined);
  assert.equal(await policy.evaluate("http://example.com/spec"), undefined);

  for (const url of [
    "/internal/path",
    "http://localhost:3000",
    "http://192.168.1.10/admin",
    "http://[::1]/admin",
    "https://",
    "file:///etc/passwd",
    "http://[::ffff:127.0.0.1]/admin"
  ]) {
    assert.deepEqual(await policy.evaluate(url), {
      permissionDecision: "deny",
      permissionDecisionReason: UNSAFE_WEB_FETCH_URL_REASON
    });
  }
});

test("tool policy web-fetch policy applies hostname DNS classification only to hostname URLs", async () => {
  const classifier = new FakeHostnameClassifier({ kind: "allowed" });
  const policy = createWebFetchPolicy({ hostnameClassifier: classifier });

  assert.equal(await policy.evaluate("https://docs.example.com/guide"), undefined);
  assert.deepEqual(classifier.calls, [
    {
      hostname: "docs.example.com",
      timeoutMs: 5000
    }
  ]);

  assert.deepEqual(await policy.evaluate("http://192.168.1.10/admin"), {
    permissionDecision: "deny",
    permissionDecisionReason: UNSAFE_WEB_FETCH_URL_REASON
  });
  assert.equal(classifier.calls.length, 1);
});

test("tool policy web-fetch policy enforces exact-host and wildcard allowlist semantics", async () => {
  const exact = createWebFetchPolicy({
    webFetchAllowedHosts: ["docs.example.com"]
  });

  assert.equal(await exact.evaluate("https://docs.example.com/guide"), undefined);
  assert.equal(
    await exact.evaluate("https://Docs.Example.Com/reference"),
    undefined
  );
  assert.equal(
    await exact.evaluate("https://docs.example.com.:8443/guide"),
    undefined
  );
  assert.deepEqual(await exact.evaluate("https://react.dev/reference"), {
    permissionDecision: "deny",
    permissionDecisionReason: CONFIGURED_WEB_FETCH_HOST_REASON
  });

  const wildcard = createWebFetchPolicy({
    webFetchAllowedHosts: ["react.dev", "*.example.com"]
  });

  assert.equal(await wildcard.evaluate("https://docs.example.com/guide"), undefined);
  assert.equal(
    await wildcard.evaluate("https://api.docs.example.com/v2/ref"),
    undefined
  );
  assert.equal(await wildcard.evaluate("https://react.dev/reference"), undefined);
  assert.deepEqual(await wildcard.evaluate("https://vuejs.org/guide"), {
    permissionDecision: "deny",
    permissionDecisionReason: CONFIGURED_WEB_FETCH_HOST_REASON
  });
});

test("tool policy web-fetch policy enforces denylist precedence and denylist-only mode", async () => {
  const allowAndDeny = createWebFetchPolicy({
    webFetchAllowedHosts: ["*.example.com"],
    webFetchDeniedHosts: ["internal.example.com", "*.secret.example.com"]
  });

  assert.deepEqual(await allowAndDeny.evaluate("https://internal.example.com/admin"), {
    permissionDecision: "deny",
    permissionDecisionReason: CONFIGURED_WEB_FETCH_HOST_REASON
  });
  assert.deepEqual(
    await allowAndDeny.evaluate("https://api.secret.example.com/data"),
    {
      permissionDecision: "deny",
      permissionDecisionReason: CONFIGURED_WEB_FETCH_HOST_REASON
    }
  );
  assert.equal(await allowAndDeny.evaluate("https://docs.example.com/guide"), undefined);

  const denyOnly = createWebFetchPolicy({
    webFetchDeniedHosts: ["evil.com", "*.evil.org"]
  });

  assert.deepEqual(await denyOnly.evaluate("https://evil.com/payload"), {
    permissionDecision: "deny",
    permissionDecisionReason: CONFIGURED_WEB_FETCH_HOST_REASON
  });
  assert.deepEqual(await denyOnly.evaluate("https://sub.evil.org/payload"), {
    permissionDecision: "deny",
    permissionDecisionReason: CONFIGURED_WEB_FETCH_HOST_REASON
  });
  assert.equal(await denyOnly.evaluate("https://docs.example.com/guide"), undefined);
});

test("tool policy web-fetch policy denies the initial URL before redirect traversal when host policy already fails", async () => {
  const redirectResolver = new FakeRedirectResolver({
    kind: "resolved",
    redirectChain: [new URL("https://docs.example.com/guide")]
  });
  const policy = createWebFetchPolicy({
    webFetchAllowedHosts: ["docs.example.com"],
    redirectResolver
  });

  assert.deepEqual(await policy.evaluate("https://reference.example.net/start"), {
    permissionDecision: "deny",
    permissionDecisionReason: CONFIGURED_WEB_FETCH_HOST_REASON
  });
  assert.equal(redirectResolver.calls.length, 0);
});

test("tool policy web-fetch policy validates allowlist and denylist semantics across redirect targets", async () => {
  const allowlistMiss = createWebFetchPolicy({
    webFetchAllowedHosts: ["docs.example.com"],
    redirectResolver: new FakeRedirectResolver({
      kind: "resolved",
      redirectChain: [new URL("https://reference.example.net/page")]
    })
  });

  assert.deepEqual(await allowlistMiss.evaluate("https://docs.example.com/start"), {
    permissionDecision: "deny",
    permissionDecisionReason: CONFIGURED_WEB_FETCH_HOST_REASON
  });

  const wildcardAllow = createWebFetchPolicy({
    webFetchAllowedHosts: ["*.example.com"],
    redirectResolver: new FakeRedirectResolver({
      kind: "resolved",
      redirectChain: [new URL("https://api.docs.example.com/reference")]
    })
  });

  assert.equal(await wildcardAllow.evaluate("https://docs.example.com/start"), undefined);

  const denylistHit = createWebFetchPolicy({
    webFetchAllowedHosts: ["*.example.com"],
    webFetchDeniedHosts: ["internal.example.com"],
    redirectResolver: new FakeRedirectResolver({
      kind: "resolved",
      redirectChain: [new URL("https://internal.example.com/admin")]
    })
  });

  assert.deepEqual(await denylistHit.evaluate("https://docs.example.com/start"), {
    permissionDecision: "deny",
    permissionDecisionReason: CONFIGURED_WEB_FETCH_HOST_REASON
  });
});

test("tool policy web-fetch policy enforces hostname DNS classification across redirect targets and memoizes canonical hosts", async () => {
  const classifier = new FakeHostnameClassifier(async (hostname) =>
    hostname === "internal-proxy.example.com"
      ? {
          kind: "denied",
          reason:
            "Review sessions only allow web_fetch for hostnames that resolve to public network addresses."
        }
      : { kind: "allowed" }
  );
  const denyPolicy = createWebFetchPolicy({
    hostnameClassifier: classifier,
    redirectResolver: new FakeRedirectResolver({
      kind: "resolved",
      redirectChain: [new URL("https://internal-proxy.example.com/admin")]
    })
  });

  assert.deepEqual(await denyPolicy.evaluate("https://docs.example.com/start"), {
    permissionDecision: "deny",
    permissionDecisionReason:
      "Review sessions only allow web_fetch for hostnames that resolve to public network addresses."
  });

  const memoClassifier = new FakeHostnameClassifier({ kind: "allowed" });
  const memoPolicy = createWebFetchPolicy({
    hostnameClassifier: memoClassifier,
    redirectResolver: new FakeRedirectResolver({
      kind: "resolved",
      redirectChain: [new URL("https://Docs.Example.Com./reference")]
    })
  });

  assert.equal(await memoPolicy.evaluate("https://docs.example.com/start"), undefined);
  assert.deepEqual(memoClassifier.calls, [
    {
      hostname: "docs.example.com",
      timeoutMs: 5000
    }
  ]);
});

test("tool policy web-fetch policy denies unresolved redirect chains conservatively", async () => {
  const policy = createWebFetchPolicy({
    redirectResolver: new FakeRedirectResolver({
      kind: "denied",
      reason: "Review sessions only allow web_fetch when redirect chains resolve safely."
    })
  });

  assert.deepEqual(await policy.evaluate("https://docs.example.com/start"), {
    permissionDecision: "deny",
    permissionDecisionReason:
      "Review sessions only allow web_fetch when redirect chains resolve safely."
  });
});

test("tool policy web-fetch policy can be instantiated directly with explicit dependencies", async () => {
  const policy = new ToolPolicyWebFetchPolicy({
    hostnameClassifier: new FakeHostnameClassifier({ kind: "allowed" }),
    redirectResolver: new FakeRedirectResolver({
      kind: "resolved",
      redirectChain: []
    }),
    webFetchAllowedHosts: ["docs.example.com"]
  });

  assert.equal(await policy.evaluate("https://docs.example.com/guide"), undefined);
});
