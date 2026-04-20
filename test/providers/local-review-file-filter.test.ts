import assert from "node:assert/strict";
import test from "node:test";

import { LocalReviewFileFilter } from "../../src/providers/local-review-file-filter.ts";
import { ReviewFileFilterError } from "../../src/providers/review-file-filter.ts";
import { createReviewRepoFixture } from "../helpers/git-fixture.ts";

test("LocalReviewFileFilter applies canonical .nightowl/reviewignore rules", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");

    assert.deepEqual(
      await new LocalReviewFileFilter().filterReviewableFiles(fixture.repoDir, [
        "dist/app.js",
        "packages/app/index.ts",
        "src/app.ts"
      ]),
      ["packages/app/index.ts", "src/app.ts"]
    );
  } finally {
    fixture.cleanup();
  }
});

test("LocalReviewFileFilter ignores legacy reviewignore locations when the canonical file is absent", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");
    fixture.writeFile(".nightowl/.reviewignore", "packages/**\n");

    assert.deepEqual(
      await new LocalReviewFileFilter().filterReviewableFiles(fixture.repoDir, [
        "dist/app.js",
        "packages/app/index.ts",
        "src/app.ts"
      ]),
      ["dist/app.js", "packages/app/index.ts", "src/app.ts"]
    );
  } finally {
    fixture.cleanup();
  }
});

test("LocalReviewFileFilter wraps non-ENOENT reviewignore filesystem failures in ReviewFileFilterError", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".nightowl", "not a directory\n");

    await assert.rejects(
      async () =>
        new LocalReviewFileFilter().filterReviewableFiles(fixture.repoDir, ["src/app.ts"]),
      (error: unknown) => {
        assert.ok(error instanceof ReviewFileFilterError);
        assert.equal(error.operation, "filterReviewableFiles");
        assert.ok(error.cause instanceof Error);
        assert.equal((error.cause as NodeJS.ErrnoException).code, "ENOTDIR");
        return true;
      }
    );
  } finally {
    fixture.cleanup();
  }
});
