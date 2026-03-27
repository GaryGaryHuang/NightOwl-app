import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_MAX_CONCURRENT_FILES,
  resolveMaxConcurrentFilesFromConfigObject
} from "../../src/core/max-concurrent-files.ts";

// ---------------------------------------------------------------------------
// DEFAULT_MAX_CONCURRENT_FILES
// ---------------------------------------------------------------------------

test("DEFAULT_MAX_CONCURRENT_FILES is 5", () => {
  assert.equal(DEFAULT_MAX_CONCURRENT_FILES, 5);
});

// ---------------------------------------------------------------------------
// resolveMaxConcurrentFilesFromConfigObject — default and valid
// ---------------------------------------------------------------------------

test("resolveMaxConcurrentFilesFromConfigObject: absent maxConcurrentFiles returns default", () => {
  assert.equal(resolveMaxConcurrentFilesFromConfigObject({}), 5);
});

test("resolveMaxConcurrentFilesFromConfigObject: valid integer is returned", () => {
  assert.equal(resolveMaxConcurrentFilesFromConfigObject({ maxConcurrentFiles: 10 }), 10);
});

test("resolveMaxConcurrentFilesFromConfigObject: minimum valid value 1 is accepted", () => {
  assert.equal(resolveMaxConcurrentFilesFromConfigObject({ maxConcurrentFiles: 1 }), 1);
});

test("resolveMaxConcurrentFilesFromConfigObject: unrelated keys coexist without effect", () => {
  assert.equal(
    resolveMaxConcurrentFilesFromConfigObject({ maxConcurrentFiles: 3, other: true }),
    3
  );
});

// ---------------------------------------------------------------------------
// resolveMaxConcurrentFilesFromConfigObject — rejection cases
// ---------------------------------------------------------------------------

test("resolveMaxConcurrentFilesFromConfigObject: value 0 throws", () => {
  assert.throws(
    () => resolveMaxConcurrentFilesFromConfigObject({ maxConcurrentFiles: 0 }),
    { message: "invalid review config" }
  );
});

test("resolveMaxConcurrentFilesFromConfigObject: negative value throws", () => {
  assert.throws(
    () => resolveMaxConcurrentFilesFromConfigObject({ maxConcurrentFiles: -1 }),
    { message: "invalid review config" }
  );
});

test("resolveMaxConcurrentFilesFromConfigObject: non-integer float throws", () => {
  assert.throws(
    () => resolveMaxConcurrentFilesFromConfigObject({ maxConcurrentFiles: 2.5 }),
    { message: "invalid review config" }
  );
});

test("resolveMaxConcurrentFilesFromConfigObject: NaN throws", () => {
  assert.throws(
    () => resolveMaxConcurrentFilesFromConfigObject({ maxConcurrentFiles: NaN }),
    { message: "invalid review config" }
  );
});

test("resolveMaxConcurrentFilesFromConfigObject: Infinity throws", () => {
  assert.throws(
    () => resolveMaxConcurrentFilesFromConfigObject({ maxConcurrentFiles: Infinity }),
    { message: "invalid review config" }
  );
});

test("resolveMaxConcurrentFilesFromConfigObject: string value throws", () => {
  assert.throws(
    () => resolveMaxConcurrentFilesFromConfigObject({ maxConcurrentFiles: "5" }),
    { message: "invalid review config" }
  );
});

test("resolveMaxConcurrentFilesFromConfigObject: null value throws", () => {
  assert.throws(
    () => resolveMaxConcurrentFilesFromConfigObject({ maxConcurrentFiles: null }),
    { message: "invalid review config" }
  );
});
