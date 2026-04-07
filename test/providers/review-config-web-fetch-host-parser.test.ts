import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveWebFetchAllowedHostsFromConfigObject,
  resolveWebFetchDeniedHostsFromConfigObject
} from "../../src/providers/review-config-web-fetch-host-parser.ts";

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
    {
      webFetchAllowedHosts: [123]
    },
    {
      webFetchAllowedHosts: ["   "]
    },
    {
      webFetchAllowedHosts: ["https://docs.example.com"]
    },
    {
      webFetchAllowedHosts: ["docs.example.com:8443"]
    },
    {
      webFetchAllowedHosts: ["docs.example.com/guide"]
    },
    {
      webFetchAllowedHosts: ["192.168.1.10"]
    },
    {
      webFetchAllowedHosts: ["*"]
    },
    {
      webFetchAllowedHosts: ["*."]
    },
    {
      webFetchAllowedHosts: ["*.*.example.com"]
    },
    {
      webFetchAllowedHosts: ["example.*"]
    },
    {
      webFetchAllowedHosts: ["foo*bar.com"]
    },
    {
      webFetchAllowedHosts: ["*example.com"]
    },
    {
      webFetchAllowedHosts: ["*.example.com:8443"]
    },
    {
      webFetchAllowedHosts: ["*.example.com/guide"]
    },
    {
      webFetchAllowedHosts: ["*.192.168.1.10"]
    }
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
    {
      webFetchDeniedHosts: [123]
    },
    {
      webFetchDeniedHosts: ["   "]
    },
    {
      webFetchDeniedHosts: ["https://internal.example.com"]
    },
    {
      webFetchDeniedHosts: ["internal.example.com:8443"]
    },
    {
      webFetchDeniedHosts: ["internal.example.com/admin"]
    },
    {
      webFetchDeniedHosts: ["192.168.1.10"]
    },
    {
      webFetchDeniedHosts: ["*"]
    },
    {
      webFetchDeniedHosts: ["*."]
    },
    {
      webFetchDeniedHosts: ["*.*.example.com"]
    },
    {
      webFetchDeniedHosts: ["example.*"]
    },
    {
      webFetchDeniedHosts: ["foo*bar.com"]
    },
    {
      webFetchDeniedHosts: ["*example.com"]
    }
  ];

  for (const config of invalidDenylistConfigs) {
    assert.throws(
      () => resolveWebFetchDeniedHostsFromConfigObject(config),
      /invalid review config/u
    );
  }
});
