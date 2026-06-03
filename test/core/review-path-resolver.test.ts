import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  buildOutputTarget,
  planNoteFiles
} from "../../src/core/review-path-resolver.ts";

const FILES_PATH = "/workspace/.nightowl/review/run/files";

test("buildOutputTarget normalizes review head refs into filesystem-safe session ids", () => {
  const cases = [
    {
      label: "sanitized head ref",
      headRef: "feature/review path",
      timestamp: "03131430",
      expectedBasePath: "/workspace/.nightowl/review/feature_review_path_03131430"
    },
    {
      label: "head ref fallback",
      headRef: "refs/pull/42/head",
      timestamp: "03131430",
      expectedBasePath: "/workspace/.nightowl/review/refs_pull_42_head_03131430"
    },
    {
      label: "collapsed repeated invalid separators in head ref",
      headRef: "feature///review   path",
      timestamp: "03131430",
      expectedBasePath: "/workspace/.nightowl/review/feature_review_path_03131430"
    },
    {
      label: "current branch name does not affect naming",
      headRef: "refs/heads/review-target",
      timestamp: "04101200",
      expectedBasePath: "/workspace/.nightowl/review/refs_heads_review-target_04101200"
    }
  ];

  for (const testCase of cases) {
    const target = buildOutputTarget({
      repoRoot: "/workspace",
      headRef: testCase.headRef,
      timestamp: testCase.timestamp
    });

    assert.equal(target.basePath, testCase.expectedBasePath, testCase.label);
  }
});

test("buildOutputTarget returns review output paths", () => {
  const target = buildOutputTarget({
    repoRoot: "/workspace",
    headRef: "refs/pull/42/head",
    timestamp: "03131430"
  });

  assert.deepEqual(target, {
    basePath: "/workspace/.nightowl/review/refs_pull_42_head_03131430",
    changesetOverviewPath: "/workspace/.nightowl/review/refs_pull_42_head_03131430/changeset-overview.md",
    filesPath: "/workspace/.nightowl/review/refs_pull_42_head_03131430/files",
    indexPath: "/workspace/.nightowl/review/refs_pull_42_head_03131430/index.md",
    toolAuditPath: "/workspace/.nightowl/review/refs_pull_42_head_03131430/tool-audit.jsonl"
  });
});

test("planNoteFiles maps changed files to deterministic markdown note paths", () => {
  const cases = [
    {
      label: "root-level file",
      changedFiles: ["README.md"],
      expectedFileNames: ["README.md.md"]
    },
    {
      label: "nested file",
      changedFiles: ["src/server/routes/foo.ts"],
      expectedFileNames: ["routes_foo.ts.md"]
    },
    {
      label: "two-way filename conflict",
      changedFiles: ["src/api/index.ts", "tests/api/index.ts"],
      expectedFileNames: [
        "src_api_index.ts.md",
        "tests_api_index.ts.md"
      ]
    },
    {
      label: "multi-level conflicts preserve changed-file order",
      changedFiles: [
        "z/src/api/index.ts",
        "a/src/api/index.ts",
        "src/api/index.ts"
      ],
      expectedFileNames: [
        "z_src_api_index.ts.md",
        "a_src_api_index.ts.md",
        "src_api_index.ts.md"
      ]
    }
  ];

  for (const testCase of cases) {
    assert.deepEqual(
      planNoteFiles(FILES_PATH, testCase.changedFiles),
      testCase.changedFiles.map((filePath, index) => ({
        filePath,
        noteFilePath: path.join(FILES_PATH, testCase.expectedFileNames[index])
      })),
      testCase.label
    );
  }
});

test("planNoteFiles throws for invalid changed-file paths that have no basename", () => {
  assert.throws(
    () => planNoteFiles(FILES_PATH, [""]),
    /Invalid changed file path/u
  );
});

test("planNoteFiles throws when changed-file paths contain duplicates", () => {
  assert.throws(
    () => planNoteFiles(FILES_PATH, ["src/app.ts", "src/app.ts"]),
    /Duplicate changed file path: src\/app\.ts/u
  );
});
