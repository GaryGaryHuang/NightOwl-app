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
  const invalidConfigs: Array<Record<string, unknown>> = [
    {
      maxConcurrentFiles: 0
    },
    {
      maxConcurrentFiles: -1
    },
    {
      maxConcurrentFiles: 2.5
    },
    {
      maxConcurrentFiles: "2"
    },
    {
      confidenceThresholds: []
    },
    {
      confidenceThresholds: {
        musst: 70
      }
    },
    {
      confidenceThresholds: {
        must: 101
      }
    },
    {
      confidenceThresholds: {
        nice: "85"
      }
    }
  ];

  for (const config of invalidConfigs) {
    assert.throws(
      () => parseReviewConfig(JSON.stringify(config)),
      /invalid review config/u
    );
  }
});
