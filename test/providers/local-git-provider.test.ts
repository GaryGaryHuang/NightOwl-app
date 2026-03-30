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

test("LocalGitProvider filters changed files with .nightowl/reviewignore rules", () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");

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

test("LocalGitProvider ignores legacy reviewignore locations when canonical .nightowl/reviewignore is absent", () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");
    fixture.writeFile(".nightowl/.reviewignore", "packages/**\n");

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

    assert.deepEqual(filteredFiles, changedFiles);
  } finally {
    fixture.cleanup();
  }
});

test("LocalGitProvider excludes .nightowl namespace files from the reviewable file list", () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");
    fixture.writeFile(".nightowl/reviewconfig.json", "{}\n");
    fixture.writeFile(".nightowl/notes.md", "user-owned note\n");
    fixture.commitAll("add NightOwl managed files");

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

    assert.equal(changedFiles.includes(".nightowl/reviewignore"), true);
    assert.equal(changedFiles.includes(".nightowl/reviewconfig.json"), true);
    assert.equal(changedFiles.includes(".nightowl/notes.md"), true);
    assert.equal(filteredFiles.includes(".nightowl/reviewignore"), false);
    assert.equal(filteredFiles.includes(".nightowl/reviewconfig.json"), false);
    assert.equal(filteredFiles.includes(".nightowl/notes.md"), false);
    assert.deepEqual(filteredFiles, ["packages/app/index.ts", "src/app.ts"]);
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
