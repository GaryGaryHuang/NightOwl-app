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
  const invalidConfigs: Array<Record<string, unknown>> = [
    { confidenceThresholds: "high" },
    { confidenceThresholds: [80, 90] },
    { confidenceThresholds: null },
    { confidenceThresholds: { must: 70, extra: 50 } }
  ];

  for (const config of invalidConfigs) {
    assert.throws(
      () => resolveConfidenceThresholdsFromConfigObject(config),
      { message: "invalid review config" }
    );
  }
});

test("resolveConfidenceThresholdsFromConfigObject rejects out-of-range and non-finite threshold values", () => {
  const invalidConfigs: Array<Record<string, unknown>> = [
    { confidenceThresholds: { must: -1 } },
    { confidenceThresholds: { nice: 101 } },
    { confidenceThresholds: { must: NaN } },
    { confidenceThresholds: { nice: Infinity } },
    { confidenceThresholds: { must: "80" } }
  ];

  for (const config of invalidConfigs) {
    assert.throws(
      () => resolveConfidenceThresholdsFromConfigObject(config),
      { message: "invalid review config" }
    );
  }
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
      { message: "invalid review config" }
    );
  }
});
