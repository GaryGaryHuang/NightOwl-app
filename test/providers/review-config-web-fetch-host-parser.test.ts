import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveWebFetchAllowedHostsFromConfigObject,
  resolveWebFetchDeniedHostsFromConfigObject
} from "../../src/providers/review-config-web-fetch-host-parser.ts";

const INVALID_HOST_ENTRIES: unknown[] = [
  123,
  "   ",
  "https://docs.example.com",
  "docs.example.com:8443",
  "docs.example.com/guide",
  "192.168.1.10",
  "*",
  "*.",
  "*.*.example.com",
  "example.*",
  "foo*bar.com",
  "*example.com"
];

const INVALID_ALLOWLIST_ONLY_HOST_ENTRIES = [
  "*.example.com:8443",
  "*.example.com/guide",
  "*.192.168.1.10"
];

test("web-fetch host parser normalizes exact and wildcard host entries", () => {
  assert.deepEqual(
    resolveWebFetchAllowedHostsFromConfigObject({
      webFetchAllowedHosts: [" Docs.Example.Com. ", "*.Example.com. "]
    }),
    ["docs.example.com", "*.example.com"]
  );

  assert.deepEqual(
    resolveWebFetchDeniedHostsFromConfigObject({
      webFetchDeniedHosts: [" Internal.Example.Com. ", "*.Internal.Example.Com. "]
    }),
    ["internal.example.com", "*.internal.example.com"]
  );
});

test("web-fetch host parser preserves denylist-only and empty-denylist behavior", () => {
  assert.deepEqual(
    resolveWebFetchDeniedHostsFromConfigObject({
      webFetchDeniedHosts: []
    }),
    []
  );

  assert.deepEqual(
    resolveWebFetchDeniedHostsFromConfigObject({
      webFetchDeniedHosts: ["evil.com"]
    }),
    ["evil.com"]
  );

  assert.equal(
    resolveWebFetchAllowedHostsFromConfigObject({}),
    undefined
  );
});

test("web-fetch host parser rejects invalid allowlist entries with the stable error surface", () => {
  const invalidAllowlistConfigs: Array<Record<string, unknown>> = [
    {
      webFetchAllowedHosts: "docs.example.com"
    },
    ...[...INVALID_HOST_ENTRIES, ...INVALID_ALLOWLIST_ONLY_HOST_ENTRIES].map(
      (entry) => ({
        webFetchAllowedHosts: [entry]
      })
    )
  ];

  for (const config of invalidAllowlistConfigs) {
    assert.throws(
      () => resolveWebFetchAllowedHostsFromConfigObject(config),
      /invalid review config/u
    );
  }
});

test("web-fetch host parser rejects invalid denylist entries with the stable error surface", () => {
  const invalidDenylistConfigs: Array<Record<string, unknown>> = [
    {
      webFetchDeniedHosts: "evil.com"
    },
    ...INVALID_HOST_ENTRIES.map((entry) => ({
      webFetchDeniedHosts: [entry]
    }))
  ];

  for (const config of invalidDenylistConfigs) {
    assert.throws(
      () => resolveWebFetchDeniedHostsFromConfigObject(config),
      /invalid review config/u
    );
  }
});
