import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { LocalGitProvider } from "../../src/providers/local-git-provider.ts";
import { LocalReviewFileFilter } from "../../src/providers/local-review-file-filter.ts";
import { ReviewFileFilterError } from "../../src/providers/review-file-filter.ts";
import { createReviewRepoFixture, type ReviewRepoFixture } from "../helpers/git-fixture.ts";

interface ReviewFileFilterFixture {
  fixture: ReviewRepoFixture;
  changedFiles(): Promise<string[]>;
  filterChangedFiles(): Promise<string[]>;
  cleanup(): void;
}

function createReviewFileFilterFixture(): ReviewFileFilterFixture {
  const fixture = createReviewRepoFixture();
  const sourceProvider = new LocalGitProvider();
  const reviewFileFilter = new LocalReviewFileFilter();

  const changedFiles = (): Promise<string[]> =>
    sourceProvider.getChangedFiles(
      fixture.repoDir,
      "main",
      "feature-branch"
    );

  return {
    fixture,
    changedFiles,
    async filterChangedFiles() {
      return reviewFileFilter.filterReviewableFiles(
        fixture.repoDir,
        await changedFiles()
      );
    },
    cleanup() {
      fixture.cleanup();
    }
  };
}

test("LocalReviewFileFilter filters changed files with canonical .nightowl/reviewignore rules", async () => {
  const filterFixture = createReviewFileFilterFixture();

  try {
    filterFixture.fixture.writeFile(".nightowl/reviewignore", "dist/**\n");

    assert.deepEqual(
      await filterFixture.filterChangedFiles(),
      ["packages/app/index.ts", "src/app.ts"]
    );
  } finally {
    filterFixture.cleanup();
  }
});

test("LocalReviewFileFilter ignores legacy reviewignore locations when canonical .nightowl/reviewignore is absent", async () => {
  const filterFixture = createReviewFileFilterFixture();

  try {
    filterFixture.fixture.writeFile(".reviewignore", "dist/**\n");
    filterFixture.fixture.writeFile(".nightowl/.reviewignore", "packages/**\n");
    const changedFiles = await filterFixture.changedFiles();

    assert.deepEqual(
      await filterFixture.filterChangedFiles(),
      changedFiles
    );
  } finally {
    filterFixture.cleanup();
  }
});

test("LocalReviewFileFilter always excludes .nightowl namespace files from reviewable files", async () => {
  const filterFixture = createReviewFileFilterFixture();

  try {
    filterFixture.fixture.writeFile(
      ".nightowl/reviewignore",
      "dist/**\n!.nightowl/reviewconfig.json\n"
    );
    filterFixture.fixture.writeFile(".nightowl/reviewconfig.json", "{}\n");
    filterFixture.fixture.writeFile(".nightowl/notes.md", "user-owned note\n");
    filterFixture.fixture.commitAll("add NightOwl managed files");

    const changedFiles = await filterFixture.changedFiles();
    const filteredFiles = await filterFixture.filterChangedFiles();

    assert.equal(changedFiles.includes(".nightowl/reviewignore"), true);
    assert.equal(changedFiles.includes(".nightowl/reviewconfig.json"), true);
    assert.equal(changedFiles.includes(".nightowl/notes.md"), true);
    assert.equal(filteredFiles.includes(".nightowl/reviewignore"), false);
    assert.equal(filteredFiles.includes(".nightowl/reviewconfig.json"), false);
    assert.equal(filteredFiles.includes(".nightowl/notes.md"), false);
    assert.deepEqual(filteredFiles, ["packages/app/index.ts", "src/app.ts"]);
  } finally {
    filterFixture.cleanup();
  }
});

test("LocalReviewFileFilter preserves input order for surviving files", async () => {
  const reviewFileFilter = new LocalReviewFileFilter();

  assert.deepEqual(
    await reviewFileFilter.filterReviewableFiles("/workspace/repo", [
      "src/z.ts",
      ".nightowl/reviewconfig.json",
      "src/a.ts",
      "docs/spec.md"
    ]),
    ["src/z.ts", "src/a.ts", "docs/spec.md"]
  );
});

test("LocalReviewFileFilter wraps reviewignore read failures in ReviewFileFilterError with cause", async () => {
  const fixture = createReviewRepoFixture();

  try {
    mkdirSync(path.join(fixture.repoDir, ".nightowl", "reviewignore"), {
      recursive: true
    });
    const reviewFileFilter = new LocalReviewFileFilter();

    await assert.rejects(
      async () =>
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
