import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { LocalGitProvider } from "../../src/providers/local-git-provider.ts";
import { LocalReviewFileFilter } from "../../src/providers/local-review-file-filter.ts";
import { ReviewFileFilterError } from "../../src/providers/review-file-filter.ts";
import { createReviewRepoFixture } from "../helpers/git-fixture.ts";

test("LocalReviewFileFilter filters changed files with canonical .nightowl/reviewignore rules", () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");

    const sourceProvider = new LocalGitProvider();
    const reviewFileFilter = new LocalReviewFileFilter();
    const changedFiles = sourceProvider.getChangedFiles(
      fixture.repoDir,
      "main",
      "feature-branch"
    );

    assert.deepEqual(
      reviewFileFilter.filterReviewableFiles(fixture.repoDir, changedFiles),
      ["packages/app/index.ts", "src/app.ts"]
    );
  } finally {
    fixture.cleanup();
  }
});

test("LocalReviewFileFilter ignores legacy reviewignore locations when canonical .nightowl/reviewignore is absent", () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");
    fixture.writeFile(".nightowl/.reviewignore", "packages/**\n");

    const sourceProvider = new LocalGitProvider();
    const reviewFileFilter = new LocalReviewFileFilter();
    const changedFiles = sourceProvider.getChangedFiles(
      fixture.repoDir,
      "main",
      "feature-branch"
    );

    assert.deepEqual(
      reviewFileFilter.filterReviewableFiles(fixture.repoDir, changedFiles),
      changedFiles
    );
  } finally {
    fixture.cleanup();
  }
});

test("LocalReviewFileFilter excludes .nightowl namespace files from the reviewable file list", () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");
    fixture.writeFile(".nightowl/reviewconfig.json", "{}\n");
    fixture.writeFile(".nightowl/notes.md", "user-owned note\n");
    fixture.commitAll("add NightOwl managed files");

    const sourceProvider = new LocalGitProvider();
    const reviewFileFilter = new LocalReviewFileFilter();
    const changedFiles = sourceProvider.getChangedFiles(
      fixture.repoDir,
      "main",
      "feature-branch"
    );
    const filteredFiles = reviewFileFilter.filterReviewableFiles(
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

test("LocalReviewFileFilter preserves input order for surviving files", () => {
  const reviewFileFilter = new LocalReviewFileFilter();

  assert.deepEqual(
    reviewFileFilter.filterReviewableFiles("/workspace/repo", [
      "src/z.ts",
      ".nightowl/reviewconfig.json",
      "src/a.ts",
      "docs/spec.md"
    ]),
    ["src/z.ts", "src/a.ts", "docs/spec.md"]
  );
});

test("LocalReviewFileFilter does not allow reviewignore negation to re-include .nightowl paths", () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".nightowl/reviewignore", "!.nightowl/reviewconfig.json\n");
    fixture.writeFile(".nightowl/reviewconfig.json", "{}\n");
    fixture.commitAll("add nightowl config");

    const sourceProvider = new LocalGitProvider();
    const reviewFileFilter = new LocalReviewFileFilter();
    const changedFiles = sourceProvider.getChangedFiles(
      fixture.repoDir,
      "main",
      "feature-branch"
    );

    assert.equal(changedFiles.includes(".nightowl/reviewconfig.json"), true);
    assert.equal(
      reviewFileFilter
        .filterReviewableFiles(fixture.repoDir, changedFiles)
        .includes(".nightowl/reviewconfig.json"),
      false
    );
  } finally {
    fixture.cleanup();
  }
});

test("LocalReviewFileFilter wraps reviewignore read failures in ReviewFileFilterError with cause", () => {
  const fixture = createReviewRepoFixture();

  try {
    mkdirSync(path.join(fixture.repoDir, ".nightowl", "reviewignore"), {
      recursive: true
    });
    const reviewFileFilter = new LocalReviewFileFilter();

    assert.throws(
      () =>
        reviewFileFilter.filterReviewableFiles(fixture.repoDir, [
          "src/app.ts"
        ]),
      (error: unknown) =>
        error instanceof ReviewFileFilterError &&
        error.operation === "filterReviewableFiles" &&
        error.cause instanceof Error
    );
  } finally {
    fixture.cleanup();
  }
});
