import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import test from "node:test";

import { LocalGitProvider } from "../../src/providers/local-git-provider.ts";
import { ReviewSourceProviderError } from "../../src/providers/review-source-provider.ts";
import { createReviewRepoFixture } from "../helpers/git-fixture.ts";

// --- unit tests (stubbed GitRunner, no real I/O) ---

test("LocalGitProvider (unit) resolveRepoRoot returns runner output unchanged", () => {
  const provider = new LocalGitProvider(() => "/home/user/project");
  assert.equal(provider.resolveRepoRoot("/any/start"), "/home/user/project");
});

test("LocalGitProvider (unit) resolveRepoRoot wraps runner error in ReviewSourceProviderError", () => {
  const cause = new Error("git failed");
  const provider = new LocalGitProvider(() => { throw cause; });
  assert.throws(
    () => provider.resolveRepoRoot("/any/start"),
    (error: unknown) =>
      error instanceof ReviewSourceProviderError &&
      error.operation === "resolveRepoRoot" &&
      error.cause === cause
  );
});

test("LocalGitProvider (unit) getChangedFiles splits multiline runner output into string[]", () => {
  const provider = new LocalGitProvider(() => "src/a.ts\nsrc/b.ts\nsrc/c.ts");
  assert.deepEqual(
    provider.getChangedFiles("/repo", "main", "feature"),
    ["src/a.ts", "src/b.ts", "src/c.ts"]
  );
});

test("LocalGitProvider (unit) getChangedFiles returns [] when runner returns empty string", () => {
  const provider = new LocalGitProvider(() => "");
  assert.deepEqual(provider.getChangedFiles("/repo", "main", "feature"), []);
});

test("LocalGitProvider (unit) getChangedFiles wraps runner error in ReviewSourceProviderError", () => {
  const cause = new Error("git failed");
  const provider = new LocalGitProvider(() => { throw cause; });
  assert.throws(
    () => provider.getChangedFiles("/repo", "main", "feature"),
    (error: unknown) =>
      error instanceof ReviewSourceProviderError &&
      error.operation === "getChangedFiles" &&
      error.cause === cause
  );
});

test("LocalGitProvider (unit) getChangesetEntries splits multiline runner output into string[]", () => {
  const provider = new LocalGitProvider(() => "M\tsrc/a.ts\nD\tsrc/old.ts\nA\tsrc/new.ts");
  assert.deepEqual(
    provider.getChangesetEntries("/repo", "main", "feature"),
    ["M\tsrc/a.ts", "D\tsrc/old.ts", "A\tsrc/new.ts"]
  );
});

test("LocalGitProvider (unit) getChangesetEntries returns [] when runner returns empty string", () => {
  const provider = new LocalGitProvider(() => "");
  assert.deepEqual(provider.getChangesetEntries("/repo", "main", "feature"), []);
});

test("LocalGitProvider (unit) getChangesetEntries wraps runner error in ReviewSourceProviderError", () => {
  const cause = new Error("git failed");
  const provider = new LocalGitProvider(() => { throw cause; });
  assert.throws(
    () => provider.getChangesetEntries("/repo", "main", "feature"),
    (error: unknown) =>
      error instanceof ReviewSourceProviderError &&
      error.operation === "getChangesetEntries" &&
      error.cause === cause
  );
});

test("LocalGitProvider (unit) getDiff returns runner output unchanged when non-empty", () => {
  const diffOutput = "diff --git a/src/a.ts b/src/a.ts\n+added line";
  const provider = new LocalGitProvider(() => diffOutput);
  assert.equal(provider.getDiff("/repo", "main", "feature", "src/a.ts"), diffOutput);
});

test("LocalGitProvider (unit) getDiff returns empty string when runner returns empty string", () => {
  const provider = new LocalGitProvider(() => "");
  assert.equal(provider.getDiff("/repo", "main", "feature", "src/a.ts"), "");
});

test("LocalGitProvider (unit) getDiff wraps runner error in ReviewSourceProviderError", () => {
  const cause = new Error("git failed");
  const provider = new LocalGitProvider(() => { throw cause; });
  assert.throws(
    () => provider.getDiff("/repo", "main", "feature", "src/a.ts"),
    (error: unknown) =>
      error instanceof ReviewSourceProviderError &&
      error.operation === "getDiff" &&
      error.cause === cause
  );
});

test("LocalGitProvider (unit) getCurrentBranch returns runner output when non-empty", () => {
  const provider = new LocalGitProvider(() => "feature-branch");
  assert.equal(provider.getCurrentBranch("/repo"), "feature-branch");
});

test("LocalGitProvider (unit) getCurrentBranch returns undefined when runner returns empty string", () => {
  const provider = new LocalGitProvider(() => "");
  assert.equal(provider.getCurrentBranch("/repo"), undefined);
});

test("LocalGitProvider (unit) getCurrentBranch wraps runner error in ReviewSourceProviderError", () => {
  const cause = new Error("git failed");
  const provider = new LocalGitProvider(() => { throw cause; });
  assert.throws(
    () => provider.getCurrentBranch("/repo"),
    (error: unknown) =>
      error instanceof ReviewSourceProviderError &&
      error.operation === "getCurrentBranch" &&
      error.cause === cause
  );
});

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
