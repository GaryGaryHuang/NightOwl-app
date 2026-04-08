import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalizeHostnameForComparison,
  normalizeHostnameForNetworkChecks
} from "../../src/services/web-fetch-hostname-normalization.ts";

test("shared hostname normalization lowercases mixed-case hostnames", () => {
  assert.equal(
    normalizeHostnameForNetworkChecks("Docs.Example.Com"),
    "docs.example.com"
  );
});

test("shared hostname normalization strips surrounding brackets for network checks", () => {
  assert.equal(
    normalizeHostnameForNetworkChecks("[Docs.Example.Com]"),
    "docs.example.com"
  );
});

test("shared hostname normalization strips surrounding brackets from IPv6 address strings for network checks", () => {
  assert.equal(normalizeHostnameForNetworkChecks("[::1]"), "::1");
  assert.equal(
    normalizeHostnameForNetworkChecks("[::ffff:127.0.0.1]"),
    "::ffff:127.0.0.1"
  );
});

test("shared hostname canonicalization strips a trailing dot for comparison", () => {
  assert.equal(
    canonicalizeHostnameForComparison("Docs.Example.Com."),
    "docs.example.com"
  );
});

test("shared hostname canonicalization preserves interior structure", () => {
  assert.equal(
    canonicalizeHostnameForComparison("api.docs.example.com"),
    "api.docs.example.com"
  );
});