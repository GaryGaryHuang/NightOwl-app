import assert from "node:assert/strict";
import test from "node:test";

import { FileReviewContext } from "../../src/core/file-review-context.ts";

test("FileReviewContext preserves immutable execution metadata and starts with no sections", () => {
  const context = new FileReviewContext({
    filePath: "src/app.ts",
    noteFilePath: "/workspace/review/run/files/src__app.ts.md",
    diffContent: "@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n",
    baseRef: "main",
    headRef: "feature-branch"
  });

  assert.equal(context.filePath, "src/app.ts");
  assert.equal(
    context.noteFilePath,
    "/workspace/review/run/files/src__app.ts.md"
  );
  assert.equal(
    context.diffContent,
    "@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n"
  );
  assert.equal(context.baseRef, "main");
  assert.equal(context.headRef, "feature-branch");
  assert.equal(context.getSection("overview"), undefined);
  assert.deepEqual(context.getSectionEntries(), []);
});

test("FileReviewContext stores mutable Overview state while keeping snapshot access isolated", () => {
  const context = new FileReviewContext({
    filePath: "src/app.ts",
    noteFilePath: "/workspace/review/run/files/src__app.ts.md",
    diffContent: "@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n",
    baseRef: "main",
    headRef: "feature-branch"
  });

  context.setSection(
    "overview",
    [
      "## Overview",
      "- 整體理解：測試用概覽",
      "- 行為變更：無行為變更",
      "- 檔案職責：維護 app value",
      "- 改動目的：調整常數",
      "- 影響範圍：src/app.ts",
      "- 測試覆蓋觀察：未見對應測試異動"
    ].join("\n")
  );

  assert.match(context.getSection("overview") ?? "", /^## Overview/u);

  const snapshot = context.getSectionEntries();
  snapshot.push(["other", "should not mutate context"]);

  assert.deepEqual(context.getSectionEntries(), [
    [
      "overview",
      [
        "## Overview",
        "- 整體理解：測試用概覽",
        "- 行為變更：無行為變更",
        "- 檔案職責：維護 app value",
        "- 改動目的：調整常數",
        "- 影響範圍：src/app.ts",
        "- 測試覆蓋觀察：未見對應測試異動"
      ].join("\n")
    ]
  ]);
});
