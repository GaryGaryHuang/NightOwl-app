import assert from "node:assert/strict";
import test from "node:test";

import { resolveFileOutcomes } from "../../src/core/run-outcome-resolver.ts";
import {
  createFinding,
  createPlannedNotesFromPaths,
  createSkippedFile,
  createSuccessfulFile
} from "../helpers/completed-run-finalizer-contract-fixture.ts";

test("resolveFileOutcomes maps each planned file to its successful outcome", () => {
  const resolved = resolveFileOutcomes(
    createPlannedNotesFromPaths(["src/a.ts", "src/b.ts"]),
    [
      createSuccessfulFile("src/a.ts", [createFinding("must", 90)]),
      createSuccessfulFile("src/b.ts", [])
    ],
    []
  );

  assert.equal(resolved.length, 2);
  assert.equal(resolved[0].status, "successful");
  assert.equal(resolved[0].outcome.filePath, "src/a.ts");
  assert.equal(resolved[1].status, "successful");
  assert.equal(resolved[1].outcome.filePath, "src/b.ts");
});

test("resolveFileOutcomes maps each planned file to its skipped outcome", () => {
  const resolved = resolveFileOutcomes(
    createPlannedNotesFromPaths(["src/a.ts"]),
    [],
    [createSkippedFile("src/a.ts", "review-basis", "deterministic validation failed")]
  );

  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].status, "skipped");
  assert.equal(resolved[0].outcome.filePath, "src/a.ts");
});

test("resolveFileOutcomes gives successfulFiles precedence over skippedFiles for the same filePath", () => {
  const resolved = resolveFileOutcomes(
    createPlannedNotesFromPaths(["src/both.ts"]),
    [createSuccessfulFile("src/both.ts", [])],
    [createSkippedFile("src/both.ts", "review-basis", "deterministic validation failed")]
  );

  assert.equal(resolved[0].status, "successful");
});

test("resolveFileOutcomes throws with identifying message when a planned file is absent from both outcome sets", () => {
  assert.throws(
    () =>
      resolveFileOutcomes(
        createPlannedNotesFromPaths(["src/missing.ts"]),
        [],
        []
      ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(
        error.message,
        "Missing finalized outcome for planned file: src/missing.ts"
      );
      return true;
    }
  );
});

test("resolveFileOutcomes preserves planned order in returned array", () => {
  const resolved = resolveFileOutcomes(
    createPlannedNotesFromPaths(["c.ts", "a.ts", "b.ts"]),
    [
      createSuccessfulFile("a.ts", []),
      createSuccessfulFile("b.ts", []),
      createSuccessfulFile("c.ts", [])
    ],
    []
  );

  assert.deepEqual(
    resolved.map((r) => r.outcome.filePath),
    ["c.ts", "a.ts", "b.ts"]
  );
});

test("resolveFileOutcomes returns empty array for empty planned notes", () => {
  const resolved = resolveFileOutcomes([], [], []);

  assert.deepEqual(resolved, []);
});

test("resolveFileOutcomes handles mixed successful and skipped outcomes", () => {
  const resolved = resolveFileOutcomes(
    createPlannedNotesFromPaths(["src/ok.ts", "src/skip.ts"]),
    [createSuccessfulFile("src/ok.ts", [createFinding("nice", 85)])],
    [createSkippedFile("src/skip.ts", "step6-cognitive-simulation", "timeout")]
  );

  assert.equal(resolved[0].status, "successful");
  assert.equal(resolved[0].outcome.filePath, "src/ok.ts");
  assert.equal(resolved[1].status, "skipped");
  assert.equal(resolved[1].outcome.filePath, "src/skip.ts");
});
