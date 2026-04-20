import assert from "node:assert/strict";
import test from "node:test";

import { selectReviewableFiles } from "../../src/providers/reviewable-file-policy.ts";

test("selectReviewableFiles always excludes .nightowl namespace files", () => {
  assert.deepEqual(
    selectReviewableFiles([
      ".nightowl",
      ".nightowl/reviewignore",
      ".nightowl\\reviewconfig.json",
      "src/app.ts",
      "docs/spec.md"
    ]),
    ["src/app.ts", "docs/spec.md"]
  );
});

test("selectReviewableFiles applies reviewignore rules after namespace exclusion", () => {
  assert.deepEqual(
    selectReviewableFiles(
      [
        "src/app.ts",
        ".nightowl/reviewconfig.json",
        "dist/output.js",
        "packages/app/index.ts"
      ],
      "dist/**\n!.nightowl/reviewconfig.json\n"
    ),
    ["src/app.ts", "packages/app/index.ts"]
  );
});

test("selectReviewableFiles normalizes path separators before ignore matching", () => {
  assert.deepEqual(
    selectReviewableFiles(
      [
        "src\\app.ts",
        "dist\\output.js",
        "docs\\spec.md"
      ],
      "dist/**\n"
    ),
    ["src\\app.ts", "docs\\spec.md"]
  );
});

test("selectReviewableFiles preserves input order for surviving files", () => {
  assert.deepEqual(
    selectReviewableFiles(
      [
        "src/z.ts",
        ".nightowl/reviewconfig.json",
        "docs/spec.md",
        "src/a.ts"
      ],
      "docs/**\n"
    ),
    ["src/z.ts", "src/a.ts"]
  );
});
