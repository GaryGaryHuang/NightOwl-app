import assert from "node:assert/strict";
import test from "node:test";

import {
  CONFIGURED_WEB_FETCH_HOST_REASON,
  ToolPolicyWebFetchPolicy,
  UNSAFE_WEB_FETCH_URL_REASON
} from "../../src/services/tool-policy/tool-policy-web-fetch-policy.ts";
import {
  createWebFetchPolicy,
  FakeHostnameClassifier
} from "../helpers/tool-policy-fixture.ts";

async function assertDeniedUrls(
  policy: ToolPolicyWebFetchPolicy,
  urls: readonly string[],
  reason: string,
  label = "url"
): Promise<void> {
  for (const url of urls) {
    assert.deepEqual(await policy.evaluate(url), {
      permissionDecision: "deny",
      permissionDecisionReason: reason
    }, `${label}: ${url}`);
  }
}

async function assertAllowedUrls(
  policy: ToolPolicyWebFetchPolicy,
  urls: readonly string[],
  label = "url"
): Promise<void> {
  for (const url of urls) {
    assert.equal(await policy.evaluate(url), undefined, `${label}: ${url}`);
  }
}

const UNSAFE_URL_GATE_CASES = [
  {
    label: "relative malformed and non-https URLs",
    urls: [
      "/internal/path",
      "https://",
      "http://docs.example.com/guide",
      "http://example.com/spec",
      "file:///etc/passwd"
    ]
  },
  {
    // Representative IP-literal denials only. The full IPv4/IPv6 address-range
    // matrix (private, loopback, link-local, CGN, documentation, benchmark,
    // multicast, IPv4-mapped IPv6, etc.) is owned by
    // test/services/web-fetch-public-address-policy.test.ts.
    label: "local hosts and unsafe IP literals",
    urls: [
      "https://localhost:3000",
      "https://192.168.1.10/admin",
      "https://[::1]/admin"
    ]
  }
] as const;

test("tool policy web-fetch policy enforces the public https URL gate", async () => {
  const policy = createWebFetchPolicy();

  assert.equal(await policy.evaluate("https://docs.example.com/guide"), undefined);

  for (const group of UNSAFE_URL_GATE_CASES) {
    await assertDeniedUrls(policy, group.urls, UNSAFE_WEB_FETCH_URL_REASON, group.label);
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

  assert.deepEqual(await policy.evaluate("https://192.168.1.10/admin"), {
    permissionDecision: "deny",
    permissionDecisionReason: UNSAFE_WEB_FETCH_URL_REASON
  });
  assert.equal(classifier.calls.length, 1);
});

test("tool policy web-fetch policy enforces exact-host and wildcard allowlist semantics", async () => {
  const cases = [
    {
      label: "exact host with canonical URL spellings",
      policy: createWebFetchPolicy({
        webFetchAllowedHosts: ["docs.example.com"]
      }),
      allowedUrls: [
        "https://docs.example.com/guide",
        "https://Docs.Example.Com/reference",
        "https://docs.example.com.:8443/guide"
      ],
      deniedUrls: ["https://react.dev/reference"]
    },
    {
      label: "wildcard and exact host allowlist",
      policy: createWebFetchPolicy({
        webFetchAllowedHosts: ["react.dev", "*.example.com"]
      }),
      allowedUrls: [
        "https://docs.example.com/guide",
        "https://api.docs.example.com/v2/ref",
        "https://react.dev/reference"
      ],
      deniedUrls: ["https://vuejs.org/guide"]
    },
    {
      label: "uppercase configured allowlist hosts",
      policy: new ToolPolicyWebFetchPolicy({
        webFetchAllowedHosts: ["DOCS.EXAMPLE.COM", "*.EXAMPLE.COM"],
        hostnameClassifier: new FakeHostnameClassifier({ kind: "allowed" })
      }),
      allowedUrls: [
        "https://docs.example.com/guide",
        "https://api.example.com/v1/ref"
      ],
      deniedUrls: ["https://vuejs.org/guide"]
    }
  ];

  for (const testCase of cases) {
    await assertAllowedUrls(testCase.policy, testCase.allowedUrls, testCase.label);
    await assertDeniedUrls(
      testCase.policy,
      testCase.deniedUrls,
      CONFIGURED_WEB_FETCH_HOST_REASON,
      testCase.label
    );
  }
});

// Denylist takes precedence over the allowlist: a host that matches both
// must still be denied. The denylist-only mode (no allowlist) also works.
test("tool policy web-fetch policy lets denylist entries override allowlist matches", async () => {
  const allowAndDeny = createWebFetchPolicy({
    webFetchAllowedHosts: ["*.example.com"],
    webFetchDeniedHosts: ["internal.example.com", "*.secret.example.com"]
  });

  await assertDeniedUrls(
    allowAndDeny,
    [
      "https://internal.example.com/admin",
      "https://api.secret.example.com/data"
    ],
    CONFIGURED_WEB_FETCH_HOST_REASON,
    "denylist precedence"
  );
  await assertAllowedUrls(
    allowAndDeny,
    ["https://docs.example.com/guide"],
    "denylist precedence"
  );
});

test("tool policy web-fetch policy supports denylist-only host filtering with normalized wildcard entries", async () => {
  const denyOnly = createWebFetchPolicy({
    webFetchDeniedHosts: ["evil.com", "*.EVIL.ORG"]
  });

  await assertDeniedUrls(
    denyOnly,
    [
      "https://evil.com/payload",
      "https://sub.evil.org/payload"
    ],
    CONFIGURED_WEB_FETCH_HOST_REASON,
    "denylist-only"
  );
  await assertAllowedUrls(
    denyOnly,
    ["https://docs.example.com/guide"],
    "denylist-only"
  );
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

test("tool policy web-fetch policy uses injected addressPolicy for IP literal URLs across IPv4, IPv6, and IPv4-mapped IPv6", async () => {
  const cases = [
    {
      url: "https://93.184.216.34/",
      returnValue: false,
      expectedDecision: {
        permissionDecision: "deny",
        permissionDecisionReason: UNSAFE_WEB_FETCH_URL_REASON
      },
      expectedCalls: ["93.184.216.34"]
    },
    {
      url: "https://[2606:2800:220:1:248:1893:25c8:1946]/",
      returnValue: false,
      expectedDecision: {
        permissionDecision: "deny",
        permissionDecisionReason: UNSAFE_WEB_FETCH_URL_REASON
      },
      expectedCalls: ["2606:2800:220:1:248:1893:25c8:1946"]
    },
    {
      url: "https://[::ffff:93.184.216.34]/",
      returnValue: true,
      expectedDecision: undefined,
      expectedCalls: ["::ffff:5db8:d822"]
    }
  ] as const;

  for (const testCase of cases) {
    const addressPolicy = new FakeAddressPolicy(testCase.returnValue);
    const policy = new ToolPolicyWebFetchPolicy({
      hostnameClassifier: new FakeHostnameClassifier({ kind: "allowed" }),
      addressPolicy
    });

    assert.deepEqual(await policy.evaluate(testCase.url), testCase.expectedDecision);
    assert.deepEqual(addressPolicy.calls, testCase.expectedCalls);
  }
});

test("tool policy web-fetch policy preserves default IP literal behavior when no addressPolicy is injected", async () => {
  const policy = createWebFetchPolicy();

  assert.equal(await policy.evaluate("https://93.184.216.34/"), undefined);
  assert.deepEqual(await policy.evaluate("https://192.168.1.10/"), {
    permissionDecision: "deny",
    permissionDecisionReason: UNSAFE_WEB_FETCH_URL_REASON
  });
});
