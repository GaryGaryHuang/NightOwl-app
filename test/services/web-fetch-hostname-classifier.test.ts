import assert from "node:assert/strict";
import test from "node:test";

import {
  DefaultWebFetchHostnameClassifier,
  UNSAFE_WEB_FETCH_HOSTNAME_REASON,
  type WebFetchHostnameLookupResult
} from "../../src/services/tool-policy/web-fetch-hostname-classifier.ts";

async function assertDeniedClassification(
  classifier: DefaultWebFetchHostnameClassifier,
  hostname: string,
  timeoutMs = 5000,
  label = hostname
): Promise<void> {
  assert.deepEqual(
    await classifier.classifyHostname(hostname, { timeoutMs }),
    {
      kind: "denied",
      reason: UNSAFE_WEB_FETCH_HOSTNAME_REASON
    },
    label
  );
}

async function assertAllowedLookupResults(
  cases: ReadonlyArray<{
    hostname: string;
    label: string;
    result: WebFetchHostnameLookupResult[];
  }>
): Promise<void> {
  for (const testCase of cases) {
    const classifier = new DefaultWebFetchHostnameClassifier({
      lookupFn: async () => testCase.result
    });

    assert.deepEqual(
      await classifier.classifyHostname(testCase.hostname, { timeoutMs: 5000 }),
      { kind: "allowed" },
      testCase.label
    );
  }
}

const PUBLIC_LOOKUP_CASES = [
  {
    label: "mixed public IPv4 and IPv6 result",
    hostname: "docs.example.com",
    result: [
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 }
    ]
  },
  {
    label: "public IPv6-only result",
    hostname: "ipv6-only.example.com",
    result: [{ address: "2001:4860:4860::8888", family: 6 }]
  }
] satisfies ReadonlyArray<{
  label: string;
  hostname: string;
  result: WebFetchHostnameLookupResult[];
}>;

// Two representative non-public lookups (one IPv4 private, one IPv6 reserved)
// keep the surface contract — "deny when any resolved address is non-public"
// — under direct test. The exhaustive IPv4/IPv6 address-range table is owned
// by test/services/web-fetch-public-address-policy.test.ts and the
// classifier-to-address-policy delegation is asserted separately below.
const NON_PUBLIC_LOOKUP_CASES = [
  {
    label: "private IPv4 result",
    hostname: "private-ipv4.example.com",
    result: [{ address: "192.168.1.10", family: 4 }]
  },
  {
    label: "loopback IPv6 result",
    hostname: "loopback-ipv6.example.com",
    result: [{ address: "::1", family: 6 }]
  }
] satisfies ReadonlyArray<{
  label: string;
  hostname: string;
  result: WebFetchHostnameLookupResult[];
}>;

const FAIL_CLOSED_LOOKUP_CASES = [
  {
    label: "mixed public and private lookup result",
    hostname: "mixed.example.com",
    lookupFn: async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.5", family: 4 }
    ]
  },
  {
    label: "empty lookup result",
    hostname: "empty.example.com",
    lookupFn: async () => []
  },
  {
    label: "lookup failure",
    hostname: "failure.example.com",
    lookupFn: async () => {
      throw new Error("lookup failed");
    }
  }
] satisfies ReadonlyArray<{
  label: string;
  hostname: string;
  lookupFn: () => Promise<WebFetchHostnameLookupResult[]>;
}>;

const SLOW_LOOKUP_DELAY_MS = 20;
const LOOKUP_TIMEOUT_MS = 5;

// `lookupFn` is injected so tests never touch real DNS; the classifier itself
// determines public vs private/reserved based on the returned address.
test("DefaultWebFetchHostnameClassifier allows hostnames whose resolved addresses are entirely public", async () => {
  await assertAllowedLookupResults(PUBLIC_LOOKUP_CASES);
});

test("DefaultWebFetchHostnameClassifier denies private, loopback, unique-local, and reserved address families", async () => {
  for (const testCase of NON_PUBLIC_LOOKUP_CASES) {
    const classifier = new DefaultWebFetchHostnameClassifier({
      lookupFn: async () => testCase.result
    });

    await assertDeniedClassification(
      classifier,
      testCase.hostname,
      5000,
      testCase.label
    );
  }
});

// The classifier uses a deny-all conservative strategy: if any resolved address
// falls in a private/reserved range, or if the lookup returns nothing, or if the
// lookup errors or times out, the hostname is denied.
test("DefaultWebFetchHostnameClassifier denies fail-closed outcomes from lookup results", async () => {
  for (const testCase of FAIL_CLOSED_LOOKUP_CASES) {
    const classifier = new DefaultWebFetchHostnameClassifier({
      lookupFn: testCase.lookupFn
    });

    await assertDeniedClassification(
      classifier,
      testCase.hostname,
      5000,
      testCase.label
    );
  }
});

// Timeout is enforced with a short deadline so the classifier never blocks
// a review session indefinitely waiting for a slow DNS lookup.
test("DefaultWebFetchHostnameClassifier denies lookup timeout conservatively", async () => {
  const classifier = new DefaultWebFetchHostnameClassifier({
    lookupFn: async () =>
      await new Promise<WebFetchHostnameLookupResult[]>((resolve) => {
        setTimeout(
          () => resolve([{ address: "93.184.216.34", family: 4 }]),
          SLOW_LOOKUP_DELAY_MS
        );
      })
  });

  await assertDeniedClassification(
    classifier,
    "slow.example.com",
    LOOKUP_TIMEOUT_MS,
    "slow lookup timeout"
  );
});

test("DefaultWebFetchHostnameClassifier delegates resolved-address classification through the shared address policy", async () => {
  const seenAddresses: string[] = [];
  const classifier = new DefaultWebFetchHostnameClassifier({
    lookupFn: async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "198.51.100.10", family: 4 }
    ],
    addressPolicy: {
      isAllowed(address) {
        seenAddresses.push(address);
        return address === "93.184.216.34";
      }
    }
  });

  await assertDeniedClassification(classifier, "docs.example.com");
  assert.deepEqual(seenAddresses, ["93.184.216.34", "198.51.100.10"]);
});
