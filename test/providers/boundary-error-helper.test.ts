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

test("wrapBoundaryError converts a thrown Error via toError callback", async () => {
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

test("wrapBoundaryError preserves cause when a string is thrown", async () => {
  const wrapped = wrapBoundaryError(
    () => { throw "string error"; },
    (cause) => new Error("boundary", { cause })
  );

  await assert.rejects(wrapped, (err: Error) => {
    assert.equal(err.message, "boundary");
    assert.equal(err.cause, "string error");
    return true;
  });
});

test("wrapBoundaryError preserves cause when null is thrown", async () => {
  const wrapped = wrapBoundaryError(
    () => { throw null; },
    (cause) => new Error("boundary", { cause })
  );

  await assert.rejects(wrapped, (err: Error) => {
    assert.equal(err.cause, null);
    return true;
  });
});

test("wrapBoundaryError preserves cause when undefined is thrown", async () => {
  const wrapped = wrapBoundaryError(
    () => { throw undefined; },
    (cause) => new Error("boundary", { cause })
  );

  await assert.rejects(wrapped, (err: Error) => {
    assert.equal(err.cause, undefined);
    return true;
  });
});
