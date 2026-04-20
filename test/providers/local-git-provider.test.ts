import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import test from "node:test";

import { LocalGitProvider } from "../../src/providers/local-git-provider.ts";
import { ReviewSourceProviderError } from "../../src/providers/review-source-provider.ts";
import { createReviewRepoFixture } from "../helpers/git-fixture.ts";

function runWithSuppressedStderr(callback: () => Promise<void>): Promise<void> {
  const originalWrite = process.stderr.write;
  process.stderr.write = (() => true) as typeof process.stderr.write;

  return callback().finally(() => {
    process.stderr.write = originalWrite;
  });
}

test("LocalGitProvider resolves repository metadata from a real Git repository", async () => {
  const fixture = createReviewRepoFixture();

  try {
    const provider = new LocalGitProvider();
    const repoRoot = await provider.resolveRepoRoot(fixture.appDir);
    const branchName = await provider.getCurrentBranch(fixture.repoDir);

    assert.equal(repoRoot, realpathSync(fixture.repoDir));
    assert.equal(branchName, "feature-branch");
  } finally {
    fixture.cleanup();
  }
});

test("LocalGitProvider returns reviewable files and Step 0 changeset entries with deleted-file semantics", async () => {
  const fixture = createReviewRepoFixture();

  try {
    const provider = new LocalGitProvider();
    const changedFiles = await provider.getChangedFiles(
      fixture.repoDir,
      "main",
      "feature-branch"
    );

    assert.deepEqual(changedFiles, [
      "dist/app.js",
      "packages/app/index.ts",
      "src/app.ts"
    ]);

    const changesetEntries = await provider.getChangesetEntries(
      fixture.repoDir,
      "main",
      "feature-branch"
    );

    assert.deepEqual(changesetEntries, [
      { status: "M", path: "dist/app.js" },
      { status: "D", path: "obsolete.txt" },
      { status: "M", path: "packages/app/index.ts" },
      { status: "M", path: "src/app.ts" }
    ]);
  } finally {
    fixture.cleanup();
  }
});

test("LocalGitProvider returns a single-file diff from a real Git repository", async () => {
  const fixture = createReviewRepoFixture();

  try {
    const provider = new LocalGitProvider();
    const diff = await provider.getDiff(
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

test("LocalGitProvider preserves raw diff content from git", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile("src/whitespace.ts", "export const padded = 'x';   \n");
    fixture.commitAll("add whitespace fixture");

    const provider = new LocalGitProvider();
    const diff = await provider.getDiff(
      fixture.repoDir,
      "main",
      "feature-branch",
      "src/whitespace.ts"
    );
    const expectedDiff = execFileSync(
      "git",
      ["diff", "main...feature-branch", "--", "src/whitespace.ts"],
      { cwd: fixture.repoDir, encoding: "utf8" }
    );

    assert.equal(diff, expectedDiff);
    assert.match(diff, /\+export const padded = 'x';   \n/);
    assert.ok(diff.endsWith("\n"));
  } finally {
    fixture.cleanup();
  }
});

test("LocalGitProvider wraps git failures in ReviewSourceProviderError with operation and cause", async () => {
  const fixture = createReviewRepoFixture();

  try {
    const provider = new LocalGitProvider();

    await runWithSuppressedStderr(async () => {
      await assert.rejects(
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
