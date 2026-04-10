import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalizeHostnameForComparison,
  normalizeHostnameForNetworkChecks
} from "../../src/services/web-fetch-hostname-normalization.ts";

test("shared hostname normalization lowercases input and strips surrounding brackets for network checks", () => {
  const cases = [
    {
      input: "Docs.Example.Com",
      expected: "docs.example.com"
    },
    {
      input: "[Docs.Example.Com]",
      expected: "docs.example.com"
    },
    {
      input: "[::1]",
      expected: "::1"
    },
    {
      input: "[::ffff:127.0.0.1]",
      expected: "::ffff:127.0.0.1"
    }
  ] as const;

  for (const testCase of cases) {
    assert.equal(normalizeHostnameForNetworkChecks(testCase.input), testCase.expected);
  }
});

test("shared hostname canonicalization preserves normalized structure while stripping a trailing dot for comparison", () => {
  const cases = [
    {
      input: "Docs.Example.Com.",
      expected: "docs.example.com"
    },
    {
      input: "api.docs.example.com",
      expected: "api.docs.example.com"
    }
  ] as const;

  for (const testCase of cases) {
    assert.equal(canonicalizeHostnameForComparison(testCase.input), testCase.expected);
  }
});