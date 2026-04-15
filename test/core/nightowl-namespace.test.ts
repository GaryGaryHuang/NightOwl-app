import assert from "node:assert/strict";
import test from "node:test";

import {
  nightowlRoot,
  reviewConfigPath,
  reviewIgnorePath,
  reviewOutputRoot
} from "../../src/core/nightowl-namespace.ts";

test("NightOwl namespace helpers resolve the canonical repo-local paths", () => {
  const repoRoot = "/workspace/repo";
  const cases: Array<{
    resolvePath(repoRoot: string): string;
    expected: string;
  }> = [
    {
      resolvePath: nightowlRoot,
      expected: "/workspace/repo/.nightowl"
    },
    {
      resolvePath: reviewConfigPath,
      expected: "/workspace/repo/.nightowl/reviewconfig.json"
    },
    {
      resolvePath: reviewIgnorePath,
      expected: "/workspace/repo/.nightowl/reviewignore"
    },
    {
      resolvePath: reviewOutputRoot,
      expected: "/workspace/repo/.nightowl/review"
    }
  ];

  for (const { resolvePath, expected } of cases) {
    assert.equal(resolvePath(repoRoot), expected);
  }
});
