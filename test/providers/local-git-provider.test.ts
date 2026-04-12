import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import test from "node:test";

import { LocalGitProvider } from "../../src/providers/local-git-provider.ts";
import { ReviewSourceProviderError } from "../../src/providers/review-source-provider.ts";
import { createReviewRepoFixture } from "../helpers/git-fixture.ts";

function runWithSuppressedStderr(callback: () => void): void {
  const originalWrite = process.stderr.write;
  process.stderr.write = (() => true) as typeof process.stderr.write;

  try {
    callback();
  } finally {
    process.stderr.write = originalWrite;
  }
}

test("LocalGitProvider resolves repository metadata from a real Git repository", () => {
  const fixture = createReviewRepoFixture();

  try {
    const provider = new LocalGitProvider();
    const repoRoot = provider.resolveRepoRoot(fixture.appDir);
    const branchName = provider.getCurrentBranch(fixture.repoDir);

    assert.equal(repoRoot, realpathSync(fixture.repoDir));
    assert.equal(branchName, "feature-branch");
  } finally {
    fixture.cleanup();
  }
});

test("LocalGitProvider returns reviewable files and Step 0 changeset entries with deleted-file semantics", () => {
  const fixture = createReviewRepoFixture();

  try {
    const provider = new LocalGitProvider();
    const changedFiles = provider.getChangedFiles(
      fixture.repoDir,
      "main",
      "feature-branch"
    );

    assert.deepEqual(changedFiles, [
      "dist/app.js",
      "packages/app/index.ts",
      "src/app.ts"
    ]);

    const changesetEntries = provider.getChangesetEntries(
      fixture.repoDir,
      "main",
      "feature-branch"
    );

    assert.deepEqual(changesetEntries, [
      "M\tdist/app.js",
      "D\tobsolete.txt",
      "M\tpackages/app/index.ts",
      "M\tsrc/app.ts"
    ]);
  } finally {
    fixture.cleanup();
  }
});

test("LocalGitProvider returns a single-file diff from a real Git repository", () => {
  const fixture = createReviewRepoFixture();

  try {
    const provider = new LocalGitProvider();
    const diff = provider.getDiff(
      fixture.repoDir,
      "main",
      "feature-branch",
      "src/app.ts"
    );

    assert.match(diff, /diff --git a\/src\/app\.ts b\/src\/app\.ts/);
    assert.match(diff, /-export const value = 1;/);
    assert.match(diff, /\+export const value = 2;/);
  } finally {
    fixture.cleanup();
  }
});

test("LocalGitProvider wraps git failures in ReviewSourceProviderError with operation and cause", () => {
  const fixture = createReviewRepoFixture();

  try {
    const provider = new LocalGitProvider();

    runWithSuppressedStderr(() => {
      assert.throws(
        () => provider.getChangedFiles(fixture.repoDir, "missing-base", "feature-branch"),
        (error: unknown) =>
          error instanceof ReviewSourceProviderError &&
          error.operation === "getChangedFiles" &&
          error.cause instanceof Error
      );
    });
  } finally {
    fixture.cleanup();
  }
});
