import assert from "node:assert/strict";
import test from "node:test";

import { AsyncMutex } from "../../src/providers/async-mutex.ts";

test("AsyncMutex serializes concurrent operations", async () => {
  const mutex = new AsyncMutex();
  const order: number[] = [];

  const task = (id: number, delayMs: number) =>
    mutex.run(async () => {
      order.push(id);
      await new Promise((r) => setTimeout(r, delayMs));
      order.push(id * 10);
    });

  await Promise.all([task(1, 20), task(2, 5), task(3, 1)]);

  // Tasks must complete fully in submission order, never interleaved.
  assert.deepEqual(order, [1, 10, 2, 20, 3, 30]);
});

test("AsyncMutex returns the value from fn", async () => {
  const mutex = new AsyncMutex();
  const result = await mutex.run(async () => 42);
  assert.equal(result, 42);
});

test("AsyncMutex propagates errors from fn", async () => {
  const mutex = new AsyncMutex();
  const original = new Error("boom");

  await assert.rejects(
    mutex.run(async () => { throw original; }),
    (err: Error) => {
      assert.equal(err, original);
      return true;
    }
  );
});

test("AsyncMutex allows subsequent calls after a fn throws", async () => {
  const mutex = new AsyncMutex();

  // First call throws.
  await assert.rejects(
    mutex.run(async () => { throw new Error("first fails"); })
  );

  // Second call should still execute normally.
  const result = await mutex.run(async () => "recovered");
  assert.equal(result, "recovered");
});

test("AsyncMutex preserves submission order under concurrency", async () => {
  const mutex = new AsyncMutex();
  const results: string[] = [];

  const promises = Array.from({ length: 5 }, (_, i) =>
    mutex.run(async () => {
      results.push(`start-${i}`);
      await new Promise((r) => setTimeout(r, 1));
      results.push(`end-${i}`);
    })
  );

  await Promise.all(promises);

  const expected = Array.from({ length: 5 }, (_, i) => [`start-${i}`, `end-${i}`]).flat();
  assert.deepEqual(results, expected);
});
