import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveConfidenceThresholdsFromConfigObject,
  resolveMaxConcurrentFilesFromConfigObject
} from "../../src/providers/config/review-config-field-resolvers.ts";

test("resolveConfidenceThresholdsFromConfigObject keeps defaults and supports partial overrides", () => {
  assert.deepEqual(
    resolveConfidenceThresholdsFromConfigObject({}),
    { must: 80, nice: 90 }
  );
  assert.deepEqual(
    resolveConfidenceThresholdsFromConfigObject({ confidenceThresholds: { must: 70 } }),
    { must: 70, nice: 90 }
  );
  assert.deepEqual(
    resolveConfidenceThresholdsFromConfigObject({ confidenceThresholds: { nice: 85 } }),
    { must: 80, nice: 85 }
  );
  assert.deepEqual(
    resolveConfidenceThresholdsFromConfigObject({ confidenceThresholds: { must: 0, nice: 100 } }),
    { must: 0, nice: 100 }
  );
});

test("resolveConfidenceThresholdsFromConfigObject rejects invalid threshold shapes and values", () => {
  for (const config of [
    { confidenceThresholds: "high" },
    { confidenceThresholds: null },
    { confidenceThresholds: { must: 70, extra: 50 } },
    { confidenceThresholds: { must: -1 } },
    { confidenceThresholds: { nice: 101 } },
    { confidenceThresholds: { must: "80" } }
  ]) {
    assert.throws(
      () => resolveConfidenceThresholdsFromConfigObject(config),
      /confidenceThresholds/u
    );
  }
});

test("resolveMaxConcurrentFilesFromConfigObject preserves defaults and positive integer overrides", () => {
  assert.equal(resolveMaxConcurrentFilesFromConfigObject({}), 5);
  assert.equal(resolveMaxConcurrentFilesFromConfigObject({ maxConcurrentFiles: 10 }), 10);
  assert.equal(resolveMaxConcurrentFilesFromConfigObject({ maxConcurrentFiles: 1 }), 1);
});

test("resolveMaxConcurrentFilesFromConfigObject rejects invalid values", () => {
  for (const config of [
    { maxConcurrentFiles: 0 },
    { maxConcurrentFiles: -1 },
    { maxConcurrentFiles: 2.5 },
    { maxConcurrentFiles: "5" }
  ]) {
    assert.throws(
      () => resolveMaxConcurrentFilesFromConfigObject(config),
      /maxConcurrentFiles/u
    );
  }
});
