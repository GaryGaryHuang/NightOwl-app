import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveConfidenceThresholdsFromConfigObject,
  resolveMaxConcurrentFilesFromConfigObject
} from "../../src/providers/review-config-field-resolvers.ts";

test("resolveConfidenceThresholdsFromConfigObject preserves defaults and partial overrides", () => {
  const cases: Array<{
    config: Record<string, unknown>;
    expected: { must: number; nice: number };
  }> = [
    {
      config: {},
      expected: { must: 80, nice: 90 }
    },
    {
      config: { maxConcurrentFiles: 3 },
      expected: { must: 80, nice: 90 }
    },
    {
      config: { confidenceThresholds: { must: 70 } },
      expected: { must: 70, nice: 90 }
    },
    {
      config: { confidenceThresholds: { nice: 85 } },
      expected: { must: 80, nice: 85 }
    },
    {
      config: { confidenceThresholds: { must: 70, nice: 85 } },
      expected: { must: 70, nice: 85 }
    },
    {
      config: { confidenceThresholds: { must: 0, nice: 100 } },
      expected: { must: 0, nice: 100 }
    }
  ];

  for (const { config, expected } of cases) {
    assert.deepEqual(
      resolveConfidenceThresholdsFromConfigObject(config),
      expected
    );
  }
});

test("resolveConfidenceThresholdsFromConfigObject rejects invalid config shapes", () => {
  assert.throws(
    () => resolveConfidenceThresholdsFromConfigObject({ confidenceThresholds: "high" }),
    /confidenceThresholds/u
  );
  assert.throws(
    () => resolveConfidenceThresholdsFromConfigObject({ confidenceThresholds: [80, 90] }),
    /confidenceThresholds/u
  );
  assert.throws(
    () => resolveConfidenceThresholdsFromConfigObject({ confidenceThresholds: null }),
    /confidenceThresholds/u
  );
  assert.throws(
    () => resolveConfidenceThresholdsFromConfigObject({ confidenceThresholds: { must: 70, extra: 50 } }),
    /confidenceThresholds.*extra/u
  );
});

test("resolveConfidenceThresholdsFromConfigObject rejects out-of-range and non-finite threshold values", () => {
  assert.throws(
    () => resolveConfidenceThresholdsFromConfigObject({ confidenceThresholds: { must: -1 } }),
    /confidenceThresholds\.must/u
  );
  assert.throws(
    () => resolveConfidenceThresholdsFromConfigObject({ confidenceThresholds: { nice: 101 } }),
    /confidenceThresholds\.nice/u
  );
  assert.throws(
    () => resolveConfidenceThresholdsFromConfigObject({ confidenceThresholds: { must: NaN } }),
    /confidenceThresholds\.must/u
  );
  assert.throws(
    () => resolveConfidenceThresholdsFromConfigObject({ confidenceThresholds: { nice: Infinity } }),
    /confidenceThresholds\.nice/u
  );
  assert.throws(
    () => resolveConfidenceThresholdsFromConfigObject({ confidenceThresholds: { must: "80" } }),
    /confidenceThresholds\.must/u
  );
});

test("resolveMaxConcurrentFilesFromConfigObject preserves defaults and positive integer overrides", () => {
  const cases: Array<{
    config: Record<string, unknown>;
    expected: number;
  }> = [
    {
      config: {},
      expected: 5
    },
    {
      config: { maxConcurrentFiles: 10 },
      expected: 10
    },
    {
      config: { maxConcurrentFiles: 1 },
      expected: 1
    },
    {
      config: { maxConcurrentFiles: 3, other: true },
      expected: 3
    }
  ];

  for (const { config, expected } of cases) {
    assert.equal(
      resolveMaxConcurrentFilesFromConfigObject(config),
      expected
    );
  }
});

test("resolveMaxConcurrentFilesFromConfigObject rejects non-positive, non-integer, and non-finite values", () => {
  const invalidConfigs: Array<Record<string, unknown>> = [
    { maxConcurrentFiles: 0 },
    { maxConcurrentFiles: -1 },
    { maxConcurrentFiles: 2.5 },
    { maxConcurrentFiles: NaN },
    { maxConcurrentFiles: Infinity },
    { maxConcurrentFiles: "5" },
    { maxConcurrentFiles: null }
  ];

  for (const config of invalidConfigs) {
    assert.throws(
      () => resolveMaxConcurrentFilesFromConfigObject(config),
      /maxConcurrentFiles/u
    );
  }
});
