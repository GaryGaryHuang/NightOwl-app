import assert from "node:assert/strict";
import test from "node:test";

import { parseReviewConfig } from "../../src/providers/review-config-parser.ts";
import { buildExpectedReviewConfig } from "../helpers/review-config-provider-contract-fixture.ts";

test("parseReviewConfig rejects malformed JSON and non-object top-level values", () => {
  assert.throws(() => parseReviewConfig("{"), /invalid review config/u);
  assert.throws(() => parseReviewConfig("[]"), /invalid review config/u);
  assert.throws(() => parseReviewConfig("\"review\""), /invalid review config/u);
  assert.throws(() => parseReviewConfig("null"), /invalid review config/u);
});

test("parseReviewConfig preserves run-level defaults and omission semantics", () => {
  assert.deepEqual(parseReviewConfig("{}"), buildExpectedReviewConfig());

  assert.deepEqual(
    parseReviewConfig(
      JSON.stringify({
        maxConcurrentFiles: 2
      })
    ),
    buildExpectedReviewConfig({
      maxConcurrentFiles: 2
    })
  );

  const config = parseReviewConfig(
    JSON.stringify({
      confidenceThresholds: {
        must: 70,
        nice: 85
      }
    })
  );

  assert.deepEqual(
    config,
    buildExpectedReviewConfig({
      confidenceThresholds: {
        must: 70,
        nice: 85
      }
    })
  );
  assert.equal("webFetchAllowedHosts" in config, false);
  assert.equal("webFetchDeniedHosts" in config, false);
});

test("parseReviewConfig rejects invalid run-level config fields", () => {
  assert.throws(
    () => parseReviewConfig(JSON.stringify({ maxConcurrentFiles: 0 })),
    /maxConcurrentFiles/u
  );
  assert.throws(
    () => parseReviewConfig(JSON.stringify({ maxConcurrentFiles: -1 })),
    /maxConcurrentFiles/u
  );
  assert.throws(
    () => parseReviewConfig(JSON.stringify({ maxConcurrentFiles: 2.5 })),
    /maxConcurrentFiles/u
  );
  assert.throws(
    () => parseReviewConfig(JSON.stringify({ maxConcurrentFiles: "2" })),
    /maxConcurrentFiles/u
  );
  assert.throws(
    () => parseReviewConfig(JSON.stringify({ confidenceThresholds: [] })),
    /confidenceThresholds/u
  );
  assert.throws(
    () => parseReviewConfig(JSON.stringify({ confidenceThresholds: { musst: 70 } })),
    /confidenceThresholds/u
  );
  assert.throws(
    () => parseReviewConfig(JSON.stringify({ confidenceThresholds: { must: 101 } })),
    /confidenceThresholds\.must/u
  );
  assert.throws(
    () => parseReviewConfig(JSON.stringify({ confidenceThresholds: { nice: "85" } })),
    /confidenceThresholds\.nice/u
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
