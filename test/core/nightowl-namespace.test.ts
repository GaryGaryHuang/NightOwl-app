import assert from "node:assert/strict";
import test from "node:test";

import {
  isNightOwlNamespacePath,
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

test("isNightOwlNamespacePath classifies repo-relative namespace paths", () => {
  const cases: Array<{
    filePath: string;
    expected: boolean;
  }> = [
    {
      filePath: ".nightowl",
      expected: true
    },
    {
      filePath: ".nightowl/reviewconfig.json",
      expected: true
    },
    {
      filePath: ".nightowl/review/main_0408/files/src__foo.ts.md",
      expected: true
    },
    {
      filePath: ".nightowl\\reviewconfig.json",
      expected: true
    },
    {
      filePath: "src/app.ts",
      expected: false
    },
    {
      filePath: ".nightowlrc",
      expected: false
    },
    {
      filePath: "",
      expected: false
    }
  ];

  for (const { filePath, expected } of cases) {
    assert.equal(isNightOwlNamespacePath(filePath), expected);
  }
});

test("isNightOwlNamespacePath rejects absolute paths so callers do not silently mix path models", () => {
  assert.throws(
    () =>
      isNightOwlNamespacePath("/workspace/repo/.nightowl/reviewconfig.json"),
    /repo-relative path/u
  );

  assert.throws(
    () =>
      isNightOwlNamespacePath(
        String.raw`C:\workspace\repo\.nightowl\reviewconfig.json`
      ),
    /repo-relative path/u
  );
});
