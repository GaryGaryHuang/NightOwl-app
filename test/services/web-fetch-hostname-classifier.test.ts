import assert from "node:assert/strict";
import test from "node:test";

import {
  DefaultWebFetchHostnameClassifier,
  UNSAFE_WEB_FETCH_HOSTNAME_REASON,
  type WebFetchHostnameLookupResult
} from "../../src/services/web-fetch-hostname-classifier.ts";

async function assertDeniedClassification(
  classifier: DefaultWebFetchHostnameClassifier,
  hostname: string,
  timeoutMs = 5000
): Promise<void> {
  assert.deepEqual(
    await classifier.classifyHostname(hostname, { timeoutMs }),
    {
      kind: "denied",
      reason: UNSAFE_WEB_FETCH_HOSTNAME_REASON
    }
  );
}

// `lookupFn` is injected so tests never touch real DNS; the classifier itself
// determines public vs private/reserved based on the returned address.
test("DefaultWebFetchHostnameClassifier allows hostnames whose resolved addresses are entirely public", async () => {
  const cases: Array<{
    hostname: string;
    result: WebFetchHostnameLookupResult[];
  }> = [
    {
      hostname: "docs.example.com",
      result: [
        { address: "93.184.216.34", family: 4 },
        { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 }
      ]
    },
    {
      hostname: "ipv6-only.example.com",
      result: [{ address: "2001:4860:4860::8888", family: 6 }]
    }
  ];

  for (const { hostname, result } of cases) {
    const classifier = new DefaultWebFetchHostnameClassifier({
      lookupFn: async () => result
    });

    assert.deepEqual(
      await classifier.classifyHostname(hostname, { timeoutMs: 5000 }),
      { kind: "allowed" }
    );
  }
});

test("DefaultWebFetchHostnameClassifier denies private, loopback, unique-local, and reserved address families", async () => {
  const cases: Array<{
    hostname: string;
    result: WebFetchHostnameLookupResult[];
  }> = [
    {
      hostname: "private-ipv4.example.com",
      result: [{ address: "192.168.1.10", family: 4 }]
    },
    {
      hostname: "loopback-ipv6.example.com",
      result: [{ address: "::1", family: 6 }]
    },
    {
      hostname: "unique-local-ipv6.example.com",
      result: [{ address: "fd12:3456:789a::1", family: 6 }]
    },
    {
      hostname: "site-local-ipv6.example.com",
      result: [{ address: "fec0::1", family: 6 }]
    },
    {
      hostname: "documentation-range.example.com",
      result: [{ address: "198.51.100.5", family: 4 }]
    },
    {
      hostname: "carrier-grade-nat.example.com",
      result: [{ address: "100.64.0.1", family: 4 }]
    },
    {
      hostname: "benchmark-range.example.com",
      result: [{ address: "198.18.0.10", family: 4 }]
    }
  ];

  for (const { hostname, result } of cases) {
    const classifier = new DefaultWebFetchHostnameClassifier({
      lookupFn: async () => result
    });

    await assertDeniedClassification(classifier, hostname);
  }
});

// The classifier uses a deny-all conservative strategy: if any resolved address
// falls in a private/reserved range, or if the lookup returns nothing, or if the
// lookup errors or times out, the hostname is denied.
test("DefaultWebFetchHostnameClassifier denies fail-closed outcomes from lookup results", async () => {
  const cases: Array<{
    hostname: string;
    lookupFn: () => Promise<WebFetchHostnameLookupResult[]>;
  }> = [
    {
      hostname: "mixed.example.com",
      lookupFn: async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "10.0.0.5", family: 4 }
      ]
    },
    {
      hostname: "empty.example.com",
      lookupFn: async () => []
    },
    {
      hostname: "failure.example.com",
      lookupFn: async () => {
        throw new Error("lookup failed");
      }
    }
  ];

  for (const { hostname, lookupFn } of cases) {
    const classifier = new DefaultWebFetchHostnameClassifier({ lookupFn });
    await assertDeniedClassification(classifier, hostname);
  }
});

// Timeout is enforced with a short deadline so the classifier never blocks
// a review session indefinitely waiting for a slow DNS lookup.
test("DefaultWebFetchHostnameClassifier denies lookup timeout conservatively", async () => {
  const classifier = new DefaultWebFetchHostnameClassifier({
    lookupFn: async () =>
      await new Promise<WebFetchHostnameLookupResult[]>((resolve) => {
        setTimeout(() => resolve([{ address: "93.184.216.34", family: 4 }]), 20);
      })
  });

  await assertDeniedClassification(classifier, "slow.example.com", 5);
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
