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
    userContext: []
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
    userContext: ["PR-123", "https://example.com/spec"]
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
