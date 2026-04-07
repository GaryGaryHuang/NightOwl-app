import assert from "node:assert/strict";
import test from "node:test";

import {
  CliUsageError,
  parseReviewCommand
} from "../../src/cli/parser.ts";

test("parseReviewCommand parses base and head refs", () => {
  const parsed = parseReviewCommand(["main", "feature-branch"]);

  assert.deepEqual(parsed, {
    kind: "run",
    request: {
      baseRef: "main",
      headRef: "feature-branch",
      userContext: [],
      dryRun: false
    }
  });
});

test("parseReviewCommand preserves repo path and repeated context flags", () => {
  const parsed = parseReviewCommand([
    "main",
    "feature-branch",
    "--repo",
    "./demo",
    "--context",
    "PR-123",
    "--context",
    "https://example.com/spec"
  ]);

  assert.deepEqual(parsed, {
    kind: "run",
    request: {
      baseRef: "main",
      headRef: "feature-branch",
      repoPath: "./demo",
      userContext: ["PR-123", "https://example.com/spec"],
      dryRun: false
    }
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
  const parsed = parseReviewCommand(["main", "feature-branch", "--dry-run"]);

  assert.equal(parsed.kind, "run");
  assert.equal(parsed.request.dryRun, true);
});

test("parseReviewCommand sets dryRun false when --dry-run flag is absent", () => {
  const parsed = parseReviewCommand(["main", "feature-branch"]);

  assert.equal(parsed.kind, "run");
  assert.equal(parsed.request.dryRun, false);
});

test("parseReviewCommand accepts --dry-run at start position", () => {
  const parsed = parseReviewCommand(["--dry-run", "main", "feature-branch"]);

  assert.equal(parsed.kind, "run");
  assert.equal(parsed.request.dryRun, true);
  assert.equal(parsed.request.baseRef, "main");
  assert.equal(parsed.request.headRef, "feature-branch");
});

test("parseReviewCommand accepts --dry-run in middle position", () => {
  const parsed = parseReviewCommand(["main", "--dry-run", "feature-branch"]);

  assert.equal(parsed.kind, "run");
  assert.equal(parsed.request.dryRun, true);
  assert.equal(parsed.request.baseRef, "main");
  assert.equal(parsed.request.headRef, "feature-branch");
});

test("parseReviewCommand combines --dry-run with --repo and --context", () => {
  const parsed = parseReviewCommand([
    "main",
    "feature-branch",
    "--dry-run",
    "--repo",
    "./my-repo",
    "--context",
    "PR-42"
  ]);

  assert.equal(parsed.kind, "run");
  assert.equal(parsed.request.dryRun, true);
  assert.equal(parsed.request.repoPath, "./my-repo");
  assert.deepEqual(parsed.request.userContext, ["PR-42"]);
});

test("parseReviewCommand rejects surplus positional input after head ref", () => {
  assert.throws(
    () => parseReviewCommand(["main", "feature-branch", "unexpected"]),
    (error) =>
      error instanceof CliUsageError &&
      /Unexpected positional input: unexpected/.test(error.message)
  );
});

test("parseReviewCommand rejects surplus positional input when options are interleaved", () => {
  assert.throws(
    () =>
      parseReviewCommand([
        "main",
        "--dry-run",
        "feature-branch",
        "--context",
        "PR-42",
        "unexpected"
      ]),
    (error) =>
      error instanceof CliUsageError &&
      /Unexpected positional input: unexpected/.test(error.message)
  );
});

test("parseReviewCommand does not treat --dry-run as unknown option", () => {
  assert.doesNotThrow(() => parseReviewCommand(["main", "head", "--dry-run"]));
});

test("parseReviewCommand returns check mode when --check is the only input", () => {
  const parsed = parseReviewCommand(["--check"]);

  assert.deepEqual(parsed, { kind: "check" });
});

test("parseReviewCommand gives --check precedence over refs and --dry-run", () => {
  const parsed = parseReviewCommand([
    "main",
    "feature-branch",
    "--dry-run",
    "--check"
  ]);

  assert.deepEqual(parsed, { kind: "check" });
});

test("parseReviewCommand gives --check precedence over malformed --repo", () => {
  const parsed = parseReviewCommand(["--repo", "--check"]);

  assert.deepEqual(parsed, { kind: "check" });
});

test("parseReviewCommand gives --check precedence over malformed --context", () => {
  const parsed = parseReviewCommand(["--context", "--check"]);

  assert.deepEqual(parsed, { kind: "check" });
});

test("parseReviewCommand gives --check precedence over unknown options", () => {
  const parsed = parseReviewCommand(["--check", "--bogus"]);

  assert.deepEqual(parsed, { kind: "check" });
});

test("parseReviewCommand tolerates repeated --check flags", () => {
  const parsed = parseReviewCommand(["--check", "main", "--check"]);

  assert.deepEqual(parsed, { kind: "check" });
});

test("parseReviewCommand gives --check precedence over surplus positional input", () => {
  const parsed = parseReviewCommand([
    "--check",
    "main",
    "feature-branch",
    "unexpected"
  ]);

  assert.deepEqual(parsed, { kind: "check" });
});
