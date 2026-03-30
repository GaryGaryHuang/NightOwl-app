import assert from "node:assert/strict";
import test from "node:test";

import {
  CliUsageError,
  parseReviewCommand
} from "../../src/cli/parser.ts";

test("parseReviewCommand parses base and head refs", () => {
  const request = parseReviewCommand(["main", "feature-branch"]);

  assert.deepEqual(request, {
    baseRef: "main",
    headRef: "feature-branch",
    userContext: [],
    dryRun: false
  });
});

test("parseReviewCommand preserves repo path and repeated context flags", () => {
  const request = parseReviewCommand([
    "main",
    "feature-branch",
    "--repo",
    "./demo",
    "--context",
    "PR-123",
    "--context",
    "https://example.com/spec"
  ]);

  assert.deepEqual(request, {
    baseRef: "main",
    headRef: "feature-branch",
    repoPath: "./demo",
    userContext: ["PR-123", "https://example.com/spec"],
    dryRun: false
  });
});

test("parseReviewCommand rejects --repo when the next token is another flag", () => {
  assert.throws(
    () => parseReviewCommand(["main", "head", "--repo", "--context", "x"]),
    (error) =>
      error instanceof CliUsageError &&
      /Missing value for --repo/.test(error.message)
  );
});

test("parseReviewCommand rejects --context when the next token is another flag", () => {
  assert.throws(
    () => parseReviewCommand(["main", "head", "--context", "--repo", "./demo"]),
    (error) =>
      error instanceof CliUsageError &&
      /Missing value for --context/.test(error.message)
  );
});

test("parseReviewCommand sets dryRun true when --dry-run flag is present at end", () => {
  const request = parseReviewCommand(["main", "feature-branch", "--dry-run"]);

  assert.equal(request.dryRun, true);
});

test("parseReviewCommand sets dryRun false when --dry-run flag is absent", () => {
  const request = parseReviewCommand(["main", "feature-branch"]);

  assert.equal(request.dryRun, false);
});

test("parseReviewCommand accepts --dry-run at start position", () => {
  const request = parseReviewCommand(["--dry-run", "main", "feature-branch"]);

  assert.equal(request.dryRun, true);
  assert.equal(request.baseRef, "main");
  assert.equal(request.headRef, "feature-branch");
});

test("parseReviewCommand accepts --dry-run in middle position", () => {
  const request = parseReviewCommand(["main", "--dry-run", "feature-branch"]);

  assert.equal(request.dryRun, true);
  assert.equal(request.baseRef, "main");
  assert.equal(request.headRef, "feature-branch");
});

test("parseReviewCommand combines --dry-run with --repo and --context", () => {
  const request = parseReviewCommand([
    "main",
    "feature-branch",
    "--dry-run",
    "--repo",
    "./my-repo",
    "--context",
    "PR-42"
  ]);

  assert.equal(request.dryRun, true);
  assert.equal(request.repoPath, "./my-repo");
  assert.deepEqual(request.userContext, ["PR-42"]);
});

test("parseReviewCommand does not treat --dry-run as unknown option", () => {
  assert.doesNotThrow(() => parseReviewCommand(["main", "head", "--dry-run"]));
});
