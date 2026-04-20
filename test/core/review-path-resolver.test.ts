import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  buildOutputTarget,
  buildSessionId,
  planNoteFiles
} from "../../src/core/review-path-resolver.ts";

const FILES_PATH = "/workspace/.nightowl/review/run/files";

test("buildSessionId normalizes branch and head refs into filesystem-safe session ids", () => {
  const cases = [
    {
      label: "sanitized branch name",
      input: {
        branchName: "feature/review path",
        headRef: "feature/review path",
        timestamp: "03131430"
      },
      expected: "feature_review_path_03131430"
    },
    {
      label: "head ref fallback",
      input: {
        headRef: "refs/pull/42/head",
        timestamp: "03131430"
      },
      expected: "refs_pull_42_head_03131430"
    },
    {
      label: "collapsed repeated invalid separators",
      input: {
        branchName: "feature///review   path",
        headRef: "feature///review   path",
        timestamp: "03131430"
      },
      expected: "feature_review_path_03131430"
    },
    {
      label: "narrow BuildSessionIdInput without repoRoot",
      input: {
        branchName: "main",
        headRef: "main",
        timestamp: "04101200"
      },
      expected: "main_04101200"
    }
  ];

  for (const testCase of cases) {
    assert.equal(buildSessionId(testCase.input), testCase.expected, testCase.label);
  }
});

test("buildOutputTarget returns review output paths", () => {
  const target = buildOutputTarget({
    repoRoot: "/workspace",
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
    verifierReportPath: "/workspace/.nightowl/review/feature_login_03131430/verifier-report.jsonl",
    manifestPath: "/workspace/.nightowl/review/feature_login_03131430/manifest.json",
    toolAuditPath: "/workspace/.nightowl/review/feature_login_03131430/tool-audit.jsonl"
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
      expectedFileNames: ["routes__foo.ts.md"]
    },
    {
      label: "two-way filename conflict",
      changedFiles: ["src/api/index.ts", "tests/api/index.ts"],
      expectedFileNames: [
        "src__api__index.ts.md",
        "tests__api__index.ts.md"
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
        "z__src__api__index.ts.md",
        "a__src__api__index.ts.md",
        "src__api__index.ts.md"
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

test("planNoteFiles throws when duplicate entries cause unresolvable conflicts", () => {
  assert.throws(
    () => planNoteFiles(FILES_PATH, ["src/app.ts", "src/app.ts"]),
    /conflict resolution exceeded maximum iterations/u
  );
});
