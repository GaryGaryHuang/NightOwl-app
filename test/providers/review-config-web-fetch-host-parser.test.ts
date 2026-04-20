import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveWebFetchAllowedHostsFromConfigObject,
  resolveWebFetchDeniedHostsFromConfigObject
} from "../../src/providers/config/review-config-web-fetch-host-parser.ts";

test("web-fetch host parser normalizes exact and wildcard host entries while preserving absence semantics", () => {
  assert.deepEqual(
    resolveWebFetchAllowedHostsFromConfigObject({
      webFetchAllowedHosts: [" Docs.Example.com ", "*.API.Example.com"]
    }),
    ["docs.example.com", "*.api.example.com"]
  );
  assert.equal(
    resolveWebFetchAllowedHostsFromConfigObject({}),
    undefined
  );
  assert.deepEqual(
    resolveWebFetchDeniedHostsFromConfigObject({ webFetchDeniedHosts: [] }),
    []
  );
});

test("web-fetch host parser rejects invalid allowlist entries", () => {
  assert.throws(
    () =>
      resolveWebFetchAllowedHostsFromConfigObject({
        webFetchAllowedHosts: "docs.example.com" as unknown as string[]
      }),
    /webFetchAllowedHosts/u
  );
  assert.throws(
    () =>
      resolveWebFetchAllowedHostsFromConfigObject({
        webFetchAllowedHosts: ["https://docs.example.com"]
      }),
    /webFetchAllowedHosts/u
  );
  assert.throws(
    () =>
      resolveWebFetchAllowedHostsFromConfigObject({
        webFetchAllowedHosts: ["*docs.example.com"]
      }),
    /webFetchAllowedHosts/u
  );
});

test("web-fetch host parser rejects invalid denylist entries", () => {
  assert.throws(
    () =>
      resolveWebFetchDeniedHostsFromConfigObject({
        webFetchDeniedHosts: [""]
      }),
    /webFetchDeniedHosts/u
  );
  assert.throws(
    () =>
      resolveWebFetchDeniedHostsFromConfigObject({
        webFetchDeniedHosts: ["127.0.0.1"]
      }),
    /webFetchDeniedHosts/u
  );
});
