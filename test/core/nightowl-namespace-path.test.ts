import assert from "node:assert/strict";
import test from "node:test";

import { isNightOwlNamespacePath } from "../../src/core/nightowl-namespace-path.ts";

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
