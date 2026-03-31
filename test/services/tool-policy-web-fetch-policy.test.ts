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

test("tool policy web-fetch policy enforces the public https URL gate", async () => {
  const policy = createWebFetchPolicy();

  assert.equal(await policy.evaluate("https://docs.example.com/guide"), undefined);

  for (const url of [
    "/internal/path",
    "https://localhost:3000",
    "https://192.168.1.10/admin",
    "https://[::1]/admin",
    "https://",
    "file:///etc/passwd",
    "https://[::ffff:127.0.0.1]/admin"
  ]) {
    assert.deepEqual(await policy.evaluate(url), {
      permissionDecision: "deny",
      permissionDecisionReason: UNSAFE_WEB_FETCH_URL_REASON
    });
  }
});

test("tool policy web-fetch policy denies http URLs", async () => {
  const policy = createWebFetchPolicy();

  assert.deepEqual(await policy.evaluate("http://docs.example.com/guide"), {
    permissionDecision: "deny",
    permissionDecisionReason: UNSAFE_WEB_FETCH_URL_REASON
  });
  assert.deepEqual(await policy.evaluate("http://example.com/spec"), {
    permissionDecision: "deny",
    permissionDecisionReason: UNSAFE_WEB_FETCH_URL_REASON
  });
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

  assert.deepEqual(await policy.evaluate("https://192.168.1.10/admin"), {
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

// Denylist takes precedence over the allowlist: a host that matches both
// must still be denied. The denylist-only mode (no allowlist) also works.
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

// Redirect resolution has been removed from evaluate(). The redirect
// resolver is retained as a constructor dependency but must never be
// invoked during URL evaluation.
test("tool policy web-fetch policy does not invoke redirect resolver during evaluation", async () => {
  const redirectResolver = new FakeRedirectResolver({
    kind: "resolved",
    redirectChain: [new URL("https://docs.example.com/guide")]
  });
  const policy = createWebFetchPolicy({
    webFetchAllowedHosts: ["docs.example.com"],
    redirectResolver
  });

  // Allowed URL — resolver must not be called.
  assert.equal(await policy.evaluate("https://docs.example.com/guide"), undefined);
  assert.equal(redirectResolver.calls.length, 0);

  // Denied URL — resolver must still not be called.
  assert.deepEqual(await policy.evaluate("https://reference.example.net/start"), {
    permissionDecision: "deny",
    permissionDecisionReason: CONFIGURED_WEB_FETCH_HOST_REASON
  });
  assert.equal(redirectResolver.calls.length, 0);
});



// The canonical hostname (lowercased, trailing dot stripped) is passed to
// the classifier so that variant spellings map to a single classify call.
test("tool policy web-fetch policy canonicalizes hostnames for DNS classification", async () => {
  const classifier = new FakeHostnameClassifier({ kind: "allowed" });
  const policy = createWebFetchPolicy({ hostnameClassifier: classifier });

  // Trailing-dot hostname should be canonicalized before classification.
  assert.equal(await policy.evaluate("https://Docs.Example.Com.:443/ref"), undefined);
  assert.deepEqual(classifier.calls, [
    {
      hostname: "docs.example.com",
      timeoutMs: 5000
    }
  ]);
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
