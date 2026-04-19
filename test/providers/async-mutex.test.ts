import assert from "node:assert/strict";
import test from "node:test";

import { AsyncMutex } from "../../src/providers/async-mutex.ts";

test("AsyncMutex serializes concurrent runs in submission order and returns each fn value", async () => {
  const mutex = new AsyncMutex();
  const order: number[] = [];

  const task = (id: number, delayMs: number) =>
    mutex.run(async () => {
      order.push(id);
      await new Promise((r) => setTimeout(r, delayMs));
      order.push(id * 10);
      return id;
    });

  // Submit out of natural completion order: task 1 has the longest delay,
  // task 3 has the shortest. The mutex must still execute them in submission
  // order and return each fn's value to its caller.
  const results = await Promise.all([task(1, 20), task(2, 5), task(3, 1)]);

  assert.deepEqual(order, [1, 10, 2, 20, 3, 30]);
  assert.deepEqual(results, [1, 2, 3]);
});

test("AsyncMutex propagates fn errors and stays usable for subsequent runs", async () => {
  const mutex = new AsyncMutex();
  const original = new Error("boom");

  await assert.rejects(
    mutex.run(async () => { throw original; }),
    (err: Error) => {
      assert.equal(err, original);
      return true;
    }
  );

  // The queue must release after a throw so later submissions still execute.
  const recovered = await mutex.run(async () => "recovered");
  assert.equal(recovered, "recovered");
});
