import assert from "node:assert/strict";
import test from "node:test";

import { isAllowedReviewReadPath } from "../../src/core/review-access-guard.ts";

test("isAllowedReviewReadPath enforces the repo-source and review-output read boundary", () => {
  const repoRoot = "/workspace/repo";
  const cases: Array<{
    requestedPath: string;
    expected: boolean;
  }> = [
    {
      requestedPath: "/workspace/repo",
      expected: true
    },
    {
      requestedPath: "/workspace/repo/src/app.ts",
      expected: true
    },
    {
      requestedPath: "/workspace/repo/.nightowl/review",
      expected: true
    },
    {
      requestedPath: "/workspace/repo/.nightowl/review/session1/file.md",
      expected: true
    },
    {
      requestedPath: "/workspace/repo/.nightowl",
      expected: false
    },
    {
      requestedPath: "/workspace/repo/.nightowl/reviewconfig.json",
      expected: false
    },
    {
      requestedPath: "/workspace/repo/.nightowl/reviewignore",
      expected: false
    },
    {
      requestedPath: "/etc/passwd",
      expected: false
    },
    {
      requestedPath: "/workspace/repo-other/src/app.ts",
      expected: false
    }
  ];

  for (const { requestedPath, expected } of cases) {
    assert.equal(isAllowedReviewReadPath(requestedPath, repoRoot), expected);
  }
});
