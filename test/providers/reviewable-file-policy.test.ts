import assert from "node:assert/strict";
import test from "node:test";

import { selectReviewableFiles } from "../../src/providers/reviewable-file-policy.ts";

test("selectReviewableFiles excludes .nightowl files even when reviewignore would re-include them, and preserves surviving order", () => {
  assert.deepEqual(
    selectReviewableFiles(
      [
        "src/z.ts",
        ".nightowl/reviewconfig.json",
        "dist/app.js",
        ".nightowl/notes.md",
        "src/a.ts",
        "docs/spec.md"
      ],
      "dist/**\n!.nightowl/reviewconfig.json\n"
    ),
    ["src/z.ts", "src/a.ts", "docs/spec.md"]
  );
});

test("selectReviewableFiles normalizes path separators before ignore matching", () => {
  assert.deepEqual(
    selectReviewableFiles(
      ["src\\generated\\client.ts", "src\\app.ts"],
      "src/generated/**\n"
    ),
    ["src\\app.ts"]
  );
});
