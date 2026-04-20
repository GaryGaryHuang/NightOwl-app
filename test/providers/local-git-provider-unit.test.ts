import assert from "node:assert/strict";
import test from "node:test";

import { LocalGitProvider } from "../../src/providers/local-git-provider.ts";
import {
  ReviewSourceProviderError,
  type ReviewSourceProviderOperation
} from "../../src/providers/review-source-provider.ts";

test("LocalGitProvider normalizes list and scalar git output while preserving raw diff text", async () => {
  assert.deepEqual(
    await new LocalGitProvider(async () => "src/a.ts\r\nsrc/b.ts\r\n\r\n").getChangedFiles(
      "/repo",
      "main",
      "feature"
    ),
    ["src/a.ts", "src/b.ts"]
  );
  assert.equal(
    await new LocalGitProvider(async () => "/repo\n").resolveRepoRoot("/repo/packages/app"),
    "/repo"
  );
  assert.equal(
    await new LocalGitProvider(async () => "feature-branch\n").getCurrentBranch("/repo"),
    "feature-branch"
  );
  assert.equal(
    await new LocalGitProvider(async () => "\n").getCurrentBranch("/repo"),
    undefined
  );

  const diffOutput = "diff --git a/src/a.ts b/src/a.ts\n+added line   \n";
  assert.equal(
    await new LocalGitProvider(async () => diffOutput).getDiff(
      "/repo",
      "main",
      "feature",
      "src/a.ts"
    ),
    diffOutput
  );
});

test("LocalGitProvider normalizes empty git output to empty collections", async () => {
  const provider = new LocalGitProvider(async () => "");

  assert.deepEqual(await provider.getChangedFiles("/repo", "main", "feature"), []);
  assert.deepEqual(await provider.getChangesetEntries("/repo", "main", "feature"), []);
});

test("LocalGitProvider normalizes git-only status tokens onto the stable changeset contract", async () => {
  const provider = new LocalGitProvider(
    async () =>
      [
        "R86\tsrc/old-name.ts\tsrc/new-name.ts",
        "C75\tsrc/original.ts\tsrc/copied.ts",
        "T\tsrc/type-change.ts",
        "U\tsrc/unmerged.ts",
        "X\tsrc/unknown.ts",
        "B\tsrc/broken-pair.ts",
        "M100\tsrc/rewrite.ts"
      ].join("\n")
  );

  assert.deepEqual(
    await provider.getChangesetEntries("/repo", "main", "feature"),
    [
      {
        status: "R",
        previousPath: "src/old-name.ts",
        path: "src/new-name.ts",
        similarityScore: 86
      },
      {
        status: "C",
        previousPath: "src/original.ts",
        path: "src/copied.ts",
        similarityScore: 75
      },
      { status: "M", path: "src/type-change.ts" },
      { status: "M", path: "src/unmerged.ts" },
      { status: "M", path: "src/unknown.ts" },
      { status: "M", path: "src/broken-pair.ts" },
      { status: "M", path: "src/rewrite.ts", similarityScore: 100 }
    ]
  );
});

test("LocalGitProvider wraps runner failures with operation context", async () => {
  const cases: Array<{
    operation: ReviewSourceProviderOperation;
    run(provider: LocalGitProvider): Promise<unknown>;
  }> = [
    {
      operation: "resolveRepoRoot",
      run(provider) {
        return provider.resolveRepoRoot("/repo");
      }
    },
    {
      operation: "getChangedFiles",
      run(provider) {
        return provider.getChangedFiles("/repo", "main", "feature");
      }
    },
    {
      operation: "getChangesetEntries",
      run(provider) {
        return provider.getChangesetEntries("/repo", "main", "feature");
      }
    },
    {
      operation: "getDiff",
      run(provider) {
        return provider.getDiff("/repo", "main", "feature", "src/a.ts");
      }
    },
    {
      operation: "getCurrentBranch",
      run(provider) {
        return provider.getCurrentBranch("/repo");
      }
    }
  ];

  for (const { operation, run } of cases) {
    const cause = new Error("git failed");
    const provider = new LocalGitProvider(async () => {
      throw cause;
    });

    await assert.rejects(
      () => run(provider),
      (error: unknown) =>
        error instanceof ReviewSourceProviderError &&
        error.operation === operation &&
        error.cause === cause
    );
  }
});
