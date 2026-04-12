import assert from "node:assert/strict";
import test from "node:test";

import { LocalGitProvider } from "../../src/providers/local-git-provider.ts";
import {
  ReviewSourceProviderError,
  type ReviewSourceProviderOperation
} from "../../src/providers/review-source-provider.ts";

test("LocalGitProvider (unit) normalizes list-style git output", () => {
  const provider = new LocalGitProvider(() => "src/a.ts\nsrc/b.ts\n");

  assert.deepEqual(
    provider.getChangedFiles("/repo", "main", "feature"),
    ["src/a.ts", "src/b.ts"]
  );

  const changesetProvider = new LocalGitProvider(
    () => "M\tsrc/a.ts\nD\tsrc/old.ts\n"
  );

  assert.deepEqual(
    changesetProvider.getChangesetEntries("/repo", "main", "feature"),
    ["M\tsrc/a.ts", "D\tsrc/old.ts"]
  );
});

test("LocalGitProvider (unit) normalizes empty git output", () => {
  const provider = new LocalGitProvider(() => "");

  assert.deepEqual(provider.getChangedFiles("/repo", "main", "feature"), []);
  assert.deepEqual(provider.getChangesetEntries("/repo", "main", "feature"), []);
  assert.equal(provider.getDiff("/repo", "main", "feature", "src/a.ts"), "");
  assert.equal(provider.getCurrentBranch("/repo"), undefined);
});

test("LocalGitProvider (unit) returns scalar git output unchanged", () => {
  const diffOutput = "diff --git a/src/a.ts b/src/a.ts\n+added line";

  assert.equal(
    new LocalGitProvider(() => "/repo").resolveRepoRoot("/any/start"),
    "/repo"
  );
  assert.equal(
    new LocalGitProvider(() => diffOutput).getDiff(
      "/repo",
      "main",
      "feature",
      "src/a.ts"
    ),
    diffOutput
  );
  assert.equal(
    new LocalGitProvider(() => "feature-branch").getCurrentBranch("/repo"),
    "feature-branch"
  );
});

test("LocalGitProvider (unit) wraps runner failures with operation context", () => {
  const cases: Array<{
    operation: ReviewSourceProviderOperation;
    run(provider: LocalGitProvider): void;
  }> = [
    {
      operation: "resolveRepoRoot",
      run(provider) {
        provider.resolveRepoRoot("/repo");
      }
    },
    {
      operation: "getChangedFiles",
      run(provider) {
        provider.getChangedFiles("/repo", "main", "feature");
      }
    },
    {
      operation: "getChangesetEntries",
      run(provider) {
        provider.getChangesetEntries("/repo", "main", "feature");
      }
    },
    {
      operation: "getDiff",
      run(provider) {
        provider.getDiff("/repo", "main", "feature", "src/a.ts");
      }
    },
    {
      operation: "getCurrentBranch",
      run(provider) {
        provider.getCurrentBranch("/repo");
      }
    }
  ];

  for (const { operation, run } of cases) {
    const cause = new Error("git failed");
    const provider = new LocalGitProvider(() => {
      throw cause;
    });

    assert.throws(
      () => run(provider),
      (error: unknown) =>
        error instanceof ReviewSourceProviderError &&
        error.operation === operation &&
        error.cause === cause
    );
  }
});
