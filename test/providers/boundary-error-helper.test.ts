import assert from "node:assert/strict";
import test from "node:test";

import { wrapBoundaryError } from "../../src/providers/boundary-error-helper.ts";

test("wrapBoundaryError returns the value from a successful async fn", async () => {
  const result = await wrapBoundaryError(
    () => Promise.resolve("ok"),
    (cause) => new Error("should not be called", { cause })
  );
  assert.equal(result, "ok");
});

test("wrapBoundaryError converts a thrown Error via toError, preserving the original as cause", async () => {
  const original = new Error("disk full");

  const wrapped = wrapBoundaryError(
    () => Promise.reject(original),
    (cause) => new Error(`wrapped: ${(cause as Error).message}`, { cause })
  );

  await assert.rejects(wrapped, (err: Error) => {
    assert.equal(err.message, "wrapped: disk full");
    assert.equal(err.cause, original);
    return true;
  });
});

test("wrapBoundaryError preserves non-Error throws (string, null, undefined) as cause", async () => {
  for (const thrown of ["string error", null, undefined] as const) {
    const wrapped = wrapBoundaryError(
      () => { throw thrown; },
      (cause) => new Error("boundary", { cause })
    );

    await assert.rejects(wrapped, (err: Error) => {
      assert.equal(err.message, "boundary");
      assert.equal(err.cause, thrown);
      return true;
    });
  }
});
