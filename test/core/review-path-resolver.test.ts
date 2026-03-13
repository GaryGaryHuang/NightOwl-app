import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  buildOutputTarget,
  buildSessionId,
  planNoteFiles
} from "../../src/core/review-path-resolver.ts";

test("buildSessionId sanitizes branch names", () => {
  const sessionId = buildSessionId({
    outputBaseDir: "/workspace",
    branchName: "feature/review path",
    headRef: "feature/review path",
    timestamp: "03131430"
  });

  assert.equal(sessionId, "feature_review_path_03131430");
});

test("buildSessionId falls back to head ref when branch name is unavailable", () => {
  const sessionId = buildSessionId({
    outputBaseDir: "/workspace",
    headRef: "refs/pull/42/head",
    timestamp: "03131430"
  });

  assert.equal(sessionId, "refs_pull_42_head_03131430");
});

test("buildOutputTarget returns review output paths", () => {
  const target = buildOutputTarget({
    outputBaseDir: "/workspace",
    branchName: "feature_login",
    headRef: "feature_login",
    timestamp: "03131430"
  });

  assert.deepEqual(target, {
    basePath: "/workspace/review/feature_login_03131430",
    filesPath: "/workspace/review/feature_login_03131430/files",
    skippedPath: "/workspace/review/feature_login_03131430/skipped.md"
  });
});

test("planNoteFiles maps a root-level file to a markdown note", () => {
  const planned = planNoteFiles("/workspace/review/run/files", ["README.md"]);

  assert.deepEqual(planned, [
    {
      filePath: "README.md",
      noteFilePath: path.join("/workspace/review/run/files", "README.md.md")
    }
  ]);
});

test("planNoteFiles maps a nested file to a parent-prefixed markdown note", () => {
  const planned = planNoteFiles("/workspace/review/run/files", [
    "src/server/routes/foo.ts"
  ]);

  assert.deepEqual(planned, [
    {
      filePath: "src/server/routes/foo.ts",
      noteFilePath: path.join(
        "/workspace/review/run/files",
        "routes__foo.ts.md"
      )
    }
  ]);
});

test("planNoteFiles resolves naming conflicts with additional parent segments", () => {
  const planned = planNoteFiles("/workspace/review/run/files", [
    "src/api/index.ts",
    "tests/api/index.ts"
  ]);

  assert.deepEqual(planned, [
    {
      filePath: "src/api/index.ts",
      noteFilePath: path.join(
        "/workspace/review/run/files",
        "src__api__index.ts.md"
      )
    },
    {
      filePath: "tests/api/index.ts",
      noteFilePath: path.join(
        "/workspace/review/run/files",
        "tests__api__index.ts.md"
      )
    }
  ]);
});
