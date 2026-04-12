import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_CONFIDENCE_THRESHOLDS
} from "../../src/core/confidence-thresholds.ts";

test("DEFAULT_CONFIDENCE_THRESHOLDS exposes the documented must/nice defaults", () => {
  assert.deepEqual(DEFAULT_CONFIDENCE_THRESHOLDS, { must: 80, nice: 90 });
});
