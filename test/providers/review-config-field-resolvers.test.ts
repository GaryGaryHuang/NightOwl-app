import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveMaxConcurrentFilesFromConfigObject
} from "../../src/providers/config/review-config-field-resolvers.ts";

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
