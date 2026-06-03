import assert from "node:assert/strict";
import test from "node:test";

import { normalizeChangesetEntriesForChangeMap } from "../../src/core/change-map.ts";

test("normalizeChangesetEntriesForChangeMap handles regular, rename, copy, and empty-path-free entries", () => {
  const entries = [
    { status: "M" as const, path: "src/foo.ts" },
    { status: "A" as const, path: "src/bar.ts" },
    { status: "D" as const, path: "src/baz.ts" },
    { status: "R" as const, similarityScore: 100, previousPath: "old.ts", path: "new.ts" },
    { status: "C" as const, similarityScore: 75, previousPath: "src/a.ts", path: "src/b.ts" },
    { status: "M" as const, path: "src/qux.ts" }
  ];

  const result = normalizeChangesetEntriesForChangeMap(entries);

  assert.deepEqual(result.map((entry) => entry.path), [
    "src/foo.ts",
    "src/bar.ts",
    "src/baz.ts",
    "new.ts",
    "src/b.ts",
    "src/qux.ts"
  ]);
  assert.deepEqual(result.map((entry) => entry.status), [
    "M",
    "A",
    "D",
    "R",
    "A",
    "M"
  ]);
  assert.equal(result[4]?.copiedAsAdded, true);
  assert.equal(result[2]?.reviewableNonDeleted, false);
});
