import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CONFIGURED_WEB_FETCH_HOST_REASON,
  ToolPolicyWebFetchPolicy,
  UNSAFE_WEB_FETCH_URL_REASON
} from "../../src/services/tool-policy-web-fetch-policy.ts";
import {
  createWebFetchPolicy,
  FakeHostnameClassifier
} from "../helpers/tool-policy-fixture.ts";

test("tool policy web-fetch policy enforces the public https URL gate", async () => {
  const policy = createWebFetchPolicy();

  assert.equal(await policy.evaluate("https://docs.example.com/guide"), undefined);

  for (const url of [
    "/internal/path",
    "https://localhost:3000",
    "https://192.168.1.10/admin",
    "https://198.51.100.10/reference",
    "https://100.64.0.1/reference",
    "https://198.18.0.10/reference",
    "https://[::1]/admin",
    "https://[::]/admin",
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

  assert.deepEqual(await policy.evaluate("https://198.51.100.10/reference"), {
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

test("tool policy web-fetch policy does not require redirect dependencies for evaluation", async () => {
  const policy = createWebFetchPolicy({
    webFetchAllowedHosts: ["docs.example.com"]
  });

  assert.equal(await policy.evaluate("https://docs.example.com/guide"), undefined);
  assert.deepEqual(await policy.evaluate("https://reference.example.net/start"), {
    permissionDecision: "deny",
    permissionDecisionReason: CONFIGURED_WEB_FETCH_HOST_REASON
  });
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
    webFetchAllowedHosts: ["docs.example.com"]
  });

  assert.equal(await policy.evaluate("https://docs.example.com/guide"), undefined);
});

// Spy-stub that records every address passed to isAllowed() and returns a
// fixed value. Used to verify that the injected addressPolicy is actually
// wired into the IP-literal evaluation path.
class FakeAddressPolicy {
  readonly calls: string[] = [];
  readonly #returnValue: boolean;

  constructor(returnValue: boolean) {
    this.#returnValue = returnValue;
  }

  isAllowed(address: string): boolean {
    this.calls.push(address);
    return this.#returnValue;
  }
}

test("tool policy web-fetch policy uses injected addressPolicy for IPv4 literal URLs", async () => {
  const addressPolicy = new FakeAddressPolicy(false);
  const policy = new ToolPolicyWebFetchPolicy({
    hostnameClassifier: new FakeHostnameClassifier({ kind: "allowed" }),
    addressPolicy
  });

  assert.deepEqual(await policy.evaluate("https://93.184.216.34/"), {
    permissionDecision: "deny",
    permissionDecisionReason: UNSAFE_WEB_FETCH_URL_REASON
  });
  assert.deepEqual(addressPolicy.calls, ["93.184.216.34"]);
});

test("tool policy web-fetch policy uses injected addressPolicy for IPv6 literal URLs", async () => {
  const addressPolicy = new FakeAddressPolicy(false);
  const policy = new ToolPolicyWebFetchPolicy({
    hostnameClassifier: new FakeHostnameClassifier({ kind: "allowed" }),
    addressPolicy
  });

  assert.deepEqual(
    await policy.evaluate("https://[2606:2800:220:1:248:1893:25c8:1946]/"),
    {
      permissionDecision: "deny",
      permissionDecisionReason: UNSAFE_WEB_FETCH_URL_REASON
    }
  );
  assert.deepEqual(addressPolicy.calls, ["2606:2800:220:1:248:1893:25c8:1946"]);
});

test("tool policy web-fetch policy uses injected addressPolicy for IPv4-mapped IPv6 literal URLs", async () => {
  const addressPolicy = new FakeAddressPolicy(true);
  const policy = new ToolPolicyWebFetchPolicy({
    hostnameClassifier: new FakeHostnameClassifier({ kind: "allowed" }),
    addressPolicy
  });

  // Node.js URL parser normalizes ::ffff:93.184.216.34 → ::ffff:5db8:d822
  // (dotted-decimal mapped suffix converted to hex). That is the address
  // the policy receives after bracket stripping.
  assert.equal(await policy.evaluate("https://[::ffff:93.184.216.34]/"), undefined);
  assert.deepEqual(addressPolicy.calls, ["::ffff:5db8:d822"]);
});

test("tool policy web-fetch policy preserves default IP literal behavior when no addressPolicy is injected", async () => {
  const policy = createWebFetchPolicy();

  assert.equal(await policy.evaluate("https://93.184.216.34/"), undefined);
  assert.deepEqual(await policy.evaluate("https://192.168.1.10/"), {
    permissionDecision: "deny",
    permissionDecisionReason: UNSAFE_WEB_FETCH_URL_REASON
  });
});

test("tool policy web-fetch policy does not import shared hostname helpers from the classifier module", () => {
  const source = readFileSync(
    new URL("../../src/services/tool-policy-web-fetch-policy.ts", import.meta.url),
    "utf8"
  );

  assert.equal(
    /import\s*\{[^}]*canonicalizeHostnameForComparison[^}]*\}\s*from\s*"\.\/web-fetch-hostname-classifier\.ts";/u.test(
      source
    ),
    false
  );
});
