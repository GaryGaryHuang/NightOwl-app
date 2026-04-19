import assert from "node:assert/strict";
import test from "node:test";

import { parseReviewConfig } from "../../src/providers/config/review-config-parser.ts";
import { buildExpectedReviewConfig } from "../helpers/review-config-provider-contract-fixture.ts";

test("parseReviewConfig rejects malformed JSON and non-object top-level values", () => {
  assert.throws(() => parseReviewConfig("{"), /invalid review config/u);
  assert.throws(() => parseReviewConfig("[]"), /invalid review config/u);
  assert.throws(() => parseReviewConfig("\"review\""), /invalid review config/u);
  assert.throws(() => parseReviewConfig("null"), /invalid review config/u);
});

test("parseReviewConfig integrates leaf defaults and omits absent webFetch host keys", () => {
  const config = parseReviewConfig("{}");

  assert.deepEqual(config, buildExpectedReviewConfig());
  assert.equal("webFetchAllowedHosts" in config, false);
  assert.equal("webFetchDeniedHosts" in config, false);
});

test("parseReviewConfig dispatches each top-level key to its leaf parser and surfaces leaf errors", () => {
  assert.throws(
    () => parseReviewConfig(JSON.stringify({ maxConcurrentFiles: 0 })),
    /maxConcurrentFiles/u
  );
  assert.throws(
    () => parseReviewConfig(JSON.stringify({ confidenceThresholds: { must: 101 } })),
    /confidenceThresholds/u
  );
  assert.throws(
    () => parseReviewConfig(JSON.stringify({ mcpServers: { demo: { type: "local" } } })),
    /mcpServers/u
  );
  assert.throws(
    () => parseReviewConfig(JSON.stringify({ webFetchAllowedHosts: ["*"] })),
    /webFetchAllowedHosts/u
  );
  assert.throws(
    () => parseReviewConfig(JSON.stringify({ webFetchDeniedHosts: "evil.com" })),
    /webFetchDeniedHosts/u
  );
});

test("parseReviewConfig rejects unknown top-level keys", () => {
  assert.throws(
    () => parseReviewConfig(JSON.stringify({ mcpServer: {} })),
    /mcpServer/u
  );
  assert.throws(
    () => parseReviewConfig(JSON.stringify({ maxConcurrentFiles: 3, unknownField: true })),
    /unknownField/u
  );
});

test("parseReviewConfig accepts config with all five recognized keys", () => {
  const config = parseReviewConfig(
    JSON.stringify({
      maxConcurrentFiles: 3,
      confidenceThresholds: { must: 70, nice: 85 },
      mcpServers: {},
      webFetchAllowedHosts: ["docs.example.com"],
      webFetchDeniedHosts: ["evil.com"]
    })
  );

  assert.equal(config.maxConcurrentFiles, 3);
  assert.deepEqual(config.confidenceThresholds, { must: 70, nice: 85 });
  assert.deepEqual(config.mcpServers, {});
  assert.deepEqual(config.webFetchAllowedHosts, ["docs.example.com"]);
  assert.deepEqual(config.webFetchDeniedHosts, ["evil.com"]);
});
