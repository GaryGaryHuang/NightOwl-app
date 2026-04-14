import assert from "node:assert/strict";
import test from "node:test";

import { LocalGitProvider } from "../../src/providers/local-git-provider.ts";
import {
  ReviewSourceProviderError,
  type ReviewSourceProviderOperation
} from "../../src/providers/review-source-provider.ts";

test("LocalGitProvider (unit) normalizes list-style git output", async () => {
  const provider = new LocalGitProvider(async () => "src/a.ts\nsrc/b.ts\n");

  assert.deepEqual(
    await provider.getChangedFiles("/repo", "main", "feature"),
    ["src/a.ts", "src/b.ts"]
  );

  const changesetProvider = new LocalGitProvider(
    async () => "M\tsrc/a.ts\nD\tsrc/old.ts\n"
  );

  assert.deepEqual(
    await changesetProvider.getChangesetEntries("/repo", "main", "feature"),
    ["M\tsrc/a.ts", "D\tsrc/old.ts"]
  );
});

test("LocalGitProvider (unit) normalizes empty git output", async () => {
  const provider = new LocalGitProvider(async () => "");

  assert.deepEqual(await provider.getChangedFiles("/repo", "main", "feature"), []);
  assert.deepEqual(await provider.getChangesetEntries("/repo", "main", "feature"), []);
  assert.equal(await provider.getDiff("/repo", "main", "feature", "src/a.ts"), "");
  assert.equal(await provider.getCurrentBranch("/repo"), undefined);
});

test("LocalGitProvider (unit) returns scalar git output unchanged", async () => {
  const diffOutput = "diff --git a/src/a.ts b/src/a.ts\n+added line";

  assert.equal(
    await new LocalGitProvider(async () => "/repo").resolveRepoRoot("/any/start"),
    "/repo"
  );
  assert.equal(
    await new LocalGitProvider(async () => diffOutput).getDiff(
      "/repo",
      "main",
      "feature",
      "src/a.ts"
    ),
    diffOutput
  );
  assert.equal(
    await new LocalGitProvider(async () => "feature-branch").getCurrentBranch("/repo"),
    "feature-branch"
  );
});

test("LocalGitProvider (unit) wraps runner failures with operation context", async () => {
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
