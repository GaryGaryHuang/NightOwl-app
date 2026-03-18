import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import test from "node:test";

import { LocalGitProvider } from "../../src/providers/local-git-provider.ts";
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

test("LocalGitProvider filters changed files with .reviewignore rules", () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");

    const provider = new LocalGitProvider();
    const changedFiles = provider.getChangedFiles(
      fixture.repoDir,
      "main",
      "feature-branch"
    );
    const filteredFiles = provider.filterIgnoredFiles(
      fixture.repoDir,
      changedFiles
    );

    assert.deepEqual(filteredFiles, ["packages/app/index.ts", "src/app.ts"]);
  } finally {
    fixture.cleanup();
  }
});
