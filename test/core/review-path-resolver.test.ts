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

test("buildSessionId collapses repeated invalid separators in branch names", () => {
  const collapsed = buildSessionId({
    outputBaseDir: "/workspace",
    branchName: "feature///review   path",
    headRef: "feature///review   path",
    timestamp: "03131430"
  });

  assert.equal(collapsed, "feature_review_path_03131430");
});

test("buildOutputTarget returns review output paths", () => {
  const target = buildOutputTarget({
    outputBaseDir: "/workspace",
    branchName: "feature_login",
    headRef: "feature_login",
    timestamp: "03131430"
  });

  assert.deepEqual(target, {
    basePath: "/workspace/.nightowl/review/feature_login_03131430",
    changesetOverviewPath: "/workspace/.nightowl/review/feature_login_03131430/changeset-overview.md",
    filesPath: "/workspace/.nightowl/review/feature_login_03131430/files",
    skippedPath: "/workspace/.nightowl/review/feature_login_03131430/skipped.md",
    summaryPath: "/workspace/.nightowl/review/feature_login_03131430/summary.md",
    indexPath: "/workspace/.nightowl/review/feature_login_03131430/index.md",
    manifestPath: "/workspace/.nightowl/review/feature_login_03131430/manifest.json",
    toolAuditPath: "/workspace/.nightowl/review/feature_login_03131430/tool-audit.jsonl"
  });
});

test("buildOutputTarget includes toolAuditPath under the session basePath", () => {  const target = buildOutputTarget({
    outputBaseDir: "/workspace",
    branchName: "feature_login",
    headRef: "feature_login",
    timestamp: "03131430"
  });

  assert.ok(
    target.toolAuditPath.endsWith("tool-audit.jsonl"),
    "toolAuditPath must end with tool-audit.jsonl"
  );
  assert.ok(
    target.toolAuditPath.startsWith(target.basePath),
    "toolAuditPath must be under basePath"
  );
});

test("buildOutputTarget includes changesetOverviewPath under the session basePath", () => {
  const target = buildOutputTarget({
    outputBaseDir: "/workspace",
    branchName: "feature_login",
    headRef: "feature_login",
    timestamp: "03131430"
  });

  assert.equal(
    target.changesetOverviewPath,
    "/workspace/.nightowl/review/feature_login_03131430/changeset-overview.md"
  );
  assert.ok(
    target.changesetOverviewPath.startsWith(target.basePath),
    "changesetOverviewPath must be under basePath"
  );
});

test("planNoteFiles maps a root-level file to a markdown note", () => {
  const planned = planNoteFiles("/workspace/.nightowl/review/run/files", ["README.md"]);

  assert.deepEqual(planned, [
    {
      filePath: "README.md",
      noteFilePath: path.join("/workspace/.nightowl/review/run/files", "README.md.md")
    }
  ]);
});

test("planNoteFiles maps a nested file to a parent-prefixed markdown note", () => {
  const planned = planNoteFiles("/workspace/.nightowl/review/run/files", [
    "src/server/routes/foo.ts"
  ]);

  assert.deepEqual(planned, [
    {
      filePath: "src/server/routes/foo.ts",
      noteFilePath: path.join(
        "/workspace/.nightowl/review/run/files",
        "routes__foo.ts.md"
      )
    }
  ]);
});

test("planNoteFiles resolves naming conflicts with additional parent segments", () => {
  const planned = planNoteFiles("/workspace/.nightowl/review/run/files", [
    "src/api/index.ts",
    "tests/api/index.ts"
  ]);

  assert.deepEqual(planned, [
    {
      filePath: "src/api/index.ts",
      noteFilePath: path.join(
        "/workspace/.nightowl/review/run/files",
        "src__api__index.ts.md"
      )
    },
    {
      filePath: "tests/api/index.ts",
      noteFilePath: path.join(
        "/workspace/.nightowl/review/run/files",
        "tests__api__index.ts.md"
      )
    }
  ]);
});

test("planNoteFiles preserves changed-file order while resolving multi-level naming conflicts", () => {
  const planned = planNoteFiles("/workspace/.nightowl/review/run/files", [
    "z/src/api/index.ts",
    "a/src/api/index.ts",
    "src/api/index.ts"
  ]);

  assert.deepEqual(planned, [
    {
      filePath: "z/src/api/index.ts",
      noteFilePath: path.join(
        "/workspace/.nightowl/review/run/files",
        "z__src__api__index.ts.md"
      )
    },
    {
      filePath: "a/src/api/index.ts",
      noteFilePath: path.join(
        "/workspace/.nightowl/review/run/files",
        "a__src__api__index.ts.md"
      )
    },
    {
      filePath: "src/api/index.ts",
      noteFilePath: path.join(
        "/workspace/.nightowl/review/run/files",
        "src__api__index.ts.md"
      )
    }
  ]);
});

test("planNoteFiles throws for invalid changed-file paths that have no basename", () => {
  assert.throws(
    () => planNoteFiles("/workspace/.nightowl/review/run/files", [""]),
    /Invalid changed file path/u
  );
});
