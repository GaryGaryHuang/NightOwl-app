import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_CONFIDENCE_THRESHOLDS,
  parseConfidenceThresholdsConfig,
  resolveConfidenceThresholdsFromConfigObject
} from "../../src/core/confidence-thresholds.ts";

// ---------------------------------------------------------------------------
// DEFAULT_CONFIDENCE_THRESHOLDS
// ---------------------------------------------------------------------------

test("DEFAULT_CONFIDENCE_THRESHOLDS has must=80 and nice=90", () => {
  assert.deepEqual(DEFAULT_CONFIDENCE_THRESHOLDS, { must: 80, nice: 90 });
});

// ---------------------------------------------------------------------------
// resolveConfidenceThresholdsFromConfigObject — default fallback
// ---------------------------------------------------------------------------

test("resolveConfidenceThresholdsFromConfigObject: absent confidenceThresholds returns defaults", () => {
  assert.deepEqual(resolveConfidenceThresholdsFromConfigObject({}), { must: 80, nice: 90 });
});

test("resolveConfidenceThresholdsFromConfigObject: unrelated keys coexist without affecting defaults", () => {
  assert.deepEqual(
    resolveConfidenceThresholdsFromConfigObject({ maxConcurrentFiles: 3 }),
    { must: 80, nice: 90 }
  );
});

// ---------------------------------------------------------------------------
// resolveConfidenceThresholdsFromConfigObject — partial overrides
// ---------------------------------------------------------------------------

test("resolveConfidenceThresholdsFromConfigObject: partial override with only must", () => {
  assert.deepEqual(
    resolveConfidenceThresholdsFromConfigObject({ confidenceThresholds: { must: 70 } }),
    { must: 70, nice: 90 }
  );
});

test("resolveConfidenceThresholdsFromConfigObject: partial override with only nice", () => {
  assert.deepEqual(
    resolveConfidenceThresholdsFromConfigObject({ confidenceThresholds: { nice: 85 } }),
    { must: 80, nice: 85 }
  );
});

// ---------------------------------------------------------------------------
// resolveConfidenceThresholdsFromConfigObject — full override
// ---------------------------------------------------------------------------

test("resolveConfidenceThresholdsFromConfigObject: full override", () => {
  assert.deepEqual(
    resolveConfidenceThresholdsFromConfigObject({ confidenceThresholds: { must: 70, nice: 85 } }),
    { must: 70, nice: 85 }
  );
});

// ---------------------------------------------------------------------------
// resolveConfidenceThresholdsFromConfigObject — rejection cases
// ---------------------------------------------------------------------------

test("resolveConfidenceThresholdsFromConfigObject: unknown key throws", () => {
  assert.throws(
    () => resolveConfidenceThresholdsFromConfigObject({ confidenceThresholds: { must: 70, extra: 50 } }),
    { message: "invalid review config" }
  );
});

test("resolveConfidenceThresholdsFromConfigObject: string confidenceThresholds throws", () => {
  assert.throws(
    () => resolveConfidenceThresholdsFromConfigObject({ confidenceThresholds: "high" }),
    { message: "invalid review config" }
  );
});

test("resolveConfidenceThresholdsFromConfigObject: array confidenceThresholds throws", () => {
  assert.throws(
    () => resolveConfidenceThresholdsFromConfigObject({ confidenceThresholds: [80, 90] }),
    { message: "invalid review config" }
  );
});

test("resolveConfidenceThresholdsFromConfigObject: null confidenceThresholds throws", () => {
  assert.throws(
    () => resolveConfidenceThresholdsFromConfigObject({ confidenceThresholds: null }),
    { message: "invalid review config" }
  );
});

// ---------------------------------------------------------------------------
// validateThreshold boundary values (via resolveConfidenceThresholdsFromConfigObject)
// ---------------------------------------------------------------------------

test("validateThreshold: boundary value 0 is accepted", () => {
  assert.deepEqual(
    resolveConfidenceThresholdsFromConfigObject({ confidenceThresholds: { must: 0 } }),
    { must: 0, nice: 90 }
  );
});

test("validateThreshold: boundary value 100 is accepted", () => {
  assert.deepEqual(
    resolveConfidenceThresholdsFromConfigObject({ confidenceThresholds: { nice: 100 } }),
    { must: 80, nice: 100 }
  );
});

test("validateThreshold: value -1 throws", () => {
  assert.throws(
    () => resolveConfidenceThresholdsFromConfigObject({ confidenceThresholds: { must: -1 } }),
    { message: "invalid review config" }
  );
});

test("validateThreshold: value 101 throws", () => {
  assert.throws(
    () => resolveConfidenceThresholdsFromConfigObject({ confidenceThresholds: { nice: 101 } }),
    { message: "invalid review config" }
  );
});

test("validateThreshold: NaN throws", () => {
  assert.throws(
    () => resolveConfidenceThresholdsFromConfigObject({ confidenceThresholds: { must: NaN } }),
    { message: "invalid review config" }
  );
});

test("validateThreshold: Infinity throws", () => {
  assert.throws(
    () => resolveConfidenceThresholdsFromConfigObject({ confidenceThresholds: { nice: Infinity } }),
    { message: "invalid review config" }
  );
});

test("validateThreshold: string value throws", () => {
  assert.throws(
    () => resolveConfidenceThresholdsFromConfigObject({ confidenceThresholds: { must: "80" } }),
    { message: "invalid review config" }
  );
});

// ---------------------------------------------------------------------------
// parseConfidenceThresholdsConfig
// ---------------------------------------------------------------------------

test("parseConfidenceThresholdsConfig: valid JSON with partial override delegates correctly", () => {
  assert.deepEqual(
    parseConfidenceThresholdsConfig('{"confidenceThresholds":{"must":70}}'),
    { must: 70, nice: 90 }
  );
});

test("parseConfidenceThresholdsConfig: valid JSON with no confidenceThresholds returns defaults", () => {
  assert.deepEqual(
    parseConfidenceThresholdsConfig('{}'),
    { must: 80, nice: 90 }
  );
});

test("parseConfidenceThresholdsConfig: malformed JSON throws", () => {
  assert.throws(
    () => parseConfidenceThresholdsConfig("not json"),
    { message: "invalid review config" }
  );
});

test("parseConfidenceThresholdsConfig: non-object root (string) throws", () => {
  assert.throws(
    () => parseConfidenceThresholdsConfig('"string"'),
    { message: "invalid review config" }
  );
});

test("parseConfidenceThresholdsConfig: array root throws", () => {
  assert.throws(
    () => parseConfidenceThresholdsConfig("[1,2]"),
    { message: "invalid review config" }
  );
});

test("parseConfidenceThresholdsConfig: null root throws", () => {
  assert.throws(
    () => parseConfidenceThresholdsConfig("null"),
    { message: "invalid review config" }
  );
});
