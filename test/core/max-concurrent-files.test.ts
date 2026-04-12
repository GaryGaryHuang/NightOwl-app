import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_MAX_CONCURRENT_FILES
} from "../../src/core/max-concurrent-files.ts";

test("DEFAULT_MAX_CONCURRENT_FILES exposes the documented default concurrency", () => {
  assert.equal(DEFAULT_MAX_CONCURRENT_FILES, 5);
});
