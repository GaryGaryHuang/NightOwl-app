import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import test from "node:test";

import { LocalGitProvider } from "../../src/providers/local-git-provider.ts";
import { ReviewSourceProviderError } from "../../src/providers/review-source-provider.ts";
import { createReviewRepoFixture } from "../helpers/git-fixture.ts";

test("LocalGitProvider resolves the repository top-level from a subdirectory", () => {
  const fixture = createReviewRepoFixture();

  try {
    const provider = new LocalGitProvider();
    const repoRoot = provider.resolveRepoRoot(fixture.appDir);

    assert.equal(repoRoot, realpathSync(fixture.repoDir));
  } finally {
    fixture.cleanup();
  }
});

test("LocalGitProvider returns the current branch name", () => {
  const fixture = createReviewRepoFixture();

  try {
    const provider = new LocalGitProvider();
    const branchName = provider.getCurrentBranch(fixture.repoDir);

    assert.equal(branchName, "feature-branch");
  } finally {
    fixture.cleanup();
  }
});

test("LocalGitProvider lists changed files between base and head refs", () => {
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
  } finally {
    fixture.cleanup();
  }
});

test("LocalGitProvider excludes deleted files from the changed file list", () => {
  const fixture = createReviewRepoFixture();

  try {
    const provider = new LocalGitProvider();
    const changedFiles = provider.getChangedFiles(
      fixture.repoDir,
      "main",
      "feature-branch"
    );

    assert.equal(changedFiles.includes("obsolete.txt"), false);
  } finally {
    fixture.cleanup();
  }
});

// getChangesetEntries is used by Step 0 (Changeset Overview) and intentionally
// includes deleted files (D entries) so the agent sees the full picture of what
// changed. getChangedFiles (used by the per-file pipeline) excludes them because
// there is no diff to review for a deleted file.
test("LocalGitProvider returns complete name-status entries for Step 0, including deleted files", () => {
  const fixture = createReviewRepoFixture();

  try {
    const provider = new LocalGitProvider();
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

test("LocalGitProvider wraps git failures in ReviewSourceProviderError with operation and cause", () => {
  const fixture = createReviewRepoFixture();

  try {
    const provider = new LocalGitProvider();

    assert.throws(
      () => provider.getChangedFiles(fixture.repoDir, "missing-base", "feature-branch"),
      (error: unknown) =>
        error instanceof ReviewSourceProviderError &&
        error.operation === "getChangedFiles" &&
        error.cause instanceof Error
    );
  } finally {
    fixture.cleanup();
  }
});
