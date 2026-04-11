import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalizeHostnameForComparison,
  normalizeHostnameForNetworkChecks
} from "../../src/services/web-fetch-hostname-normalization.ts";

interface HostnameCase {
  input: string;
  expected: string;
}

const NETWORK_NORMALIZATION_CASES = [
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
] satisfies readonly HostnameCase[];

const COMPARISON_CANONICALIZATION_CASES = [
  {
    input: "Docs.Example.Com.",
    expected: "docs.example.com"
  },
  {
    input: "api.docs.example.com",
    expected: "api.docs.example.com"
  }
] satisfies readonly HostnameCase[];

function assertHostnameCases(
  cases: readonly HostnameCase[],
  normalize: (hostname: string) => string
): void {
  for (const testCase of cases) {
    assert.equal(
      normalize(testCase.input),
      testCase.expected,
      testCase.input
    );
  }
}

test("shared hostname normalization lowercases input and strips surrounding brackets for network checks", () => {
  assertHostnameCases(NETWORK_NORMALIZATION_CASES, normalizeHostnameForNetworkChecks);
});

test("shared hostname canonicalization preserves normalized structure while stripping a trailing dot for comparison", () => {
  assertHostnameCases(COMPARISON_CANONICALIZATION_CASES, canonicalizeHostnameForComparison);
});
