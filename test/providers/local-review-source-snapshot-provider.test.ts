import assert from "node:assert/strict";
import test from "node:test";

import {
  LocalReviewSourceSnapshotProvider,
  ReviewSourceSnapshotProviderError,
  type SnapshotGitRunner
} from "../../src/providers/local-review-source-snapshot-provider.ts";

interface GitCall {
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
}

test("LocalReviewSourceSnapshotProvider resolves refs once and creates a detached snapshot at resolved head", async () => {
  const calls: GitCall[] = [];
  const provider = new LocalReviewSourceSnapshotProvider({
    createSnapshotDirectory: async () => "/tmp/nightowl-snapshot/source",
    gitRunner: async (args, cwd, options) => {
      calls.push({ args, cwd, env: options?.env });

      if (args.join(" ") === "rev-parse --verify main^{commit}") {
        return "base-sha\n";
      }
      if (args.join(" ") === "rev-parse --verify feature^{commit}") {
        return "head-sha\n";
      }
      if (args.join(" ") === "status --porcelain=v1") {
        return "";
      }
      if (args.join(" ") === "worktree add --detach /tmp/nightowl-snapshot/source head-sha") {
        return "";
      }
      if (args.join(" ") === "worktree remove --force /tmp/nightowl-snapshot/source") {
        return "";
      }

      throw new Error(`unexpected git call: ${args.join(" ")}`);
    }
  });

  const snapshot = await provider.createSnapshot({
    repoRoot: "/repo",
    baseRef: "main",
    headRef: "feature"
  });

  assert.deepEqual(
    {
      originalRepoRoot: snapshot.originalRepoRoot,
      reviewSourceRoot: snapshot.reviewSourceRoot,
      resolvedBaseRef: snapshot.resolvedBaseRef,
      resolvedHeadRef: snapshot.resolvedHeadRef,
      isDirty: snapshot.isDirty
    },
    {
      originalRepoRoot: "/repo",
      reviewSourceRoot: "/tmp/nightowl-snapshot/source",
      resolvedBaseRef: "base-sha",
      resolvedHeadRef: "head-sha",
      isDirty: false
    }
  );

  const worktreeAdd = calls.find((call) => call.args[0] === "worktree" && call.args[1] === "add");
  assert.deepEqual(worktreeAdd?.args, [
    "worktree",
    "add",
    "--detach",
    "/tmp/nightowl-snapshot/source",
    "head-sha"
  ]);
  assert.equal(worktreeAdd?.env?.GIT_LFS_SKIP_SMUDGE, "1");

  assert.equal(
    calls.some((call) => ["fetch", "submodule", "lfs"].includes(call.args[0] ?? "")),
    false,
    "snapshot setup must not fetch, initialize submodules, or run git lfs commands"
  );

  await snapshot.cleanup();
  assert.deepEqual(calls.at(-1)?.args, [
    "worktree",
    "remove",
    "--force",
    "/tmp/nightowl-snapshot/source"
  ]);
});

test("LocalReviewSourceSnapshotProvider treats porcelain status output as dirty across staged, unstaged, deleted, and untracked paths", async () => {
  const provider = new LocalReviewSourceSnapshotProvider({
    createSnapshotDirectory: async () => "/tmp/nightowl-snapshot/dirty",
    gitRunner: createRunnerForDirtyStatus([
      "M  staged.ts",
      " M unstaged.ts",
      " D deleted.ts",
      "?? untracked.ts"
    ].join("\n"))
  });

  const snapshot = await provider.createSnapshot({
    repoRoot: "/repo",
    baseRef: "main",
    headRef: "feature"
  });

  assert.equal(snapshot.isDirty, true);
});

test("LocalReviewSourceSnapshotProvider fails unresolved refs locally without fetch fallback", async () => {
  const cases = [
    {
      name: "missing base",
      baseRef: "missing-base",
      headRef: "feature",
      missingRef: "missing-base"
    },
    {
      name: "missing head",
      baseRef: "main",
      headRef: "missing-head",
      missingRef: "missing-head"
    }
  ] as const;

  for (const testCase of cases) {
    const calls: GitCall[] = [];
    const provider = new LocalReviewSourceSnapshotProvider({
      createSnapshotDirectory: async () => `/tmp/nightowl-snapshot/${testCase.name}`,
      gitRunner: async (args, cwd, options) => {
        calls.push({ args, cwd, env: options?.env });

        if (args.join(" ") === `rev-parse --verify ${testCase.missingRef}^{commit}`) {
          throw new Error("unknown revision");
        }
        if (args.join(" ") === "rev-parse --verify main^{commit}") {
          return "base-sha\n";
        }

        throw new Error(`unexpected git call: ${args.join(" ")}`);
      }
    });

    await assert.rejects(
      () =>
        provider.createSnapshot({
          repoRoot: "/repo",
          baseRef: testCase.baseRef,
          headRef: testCase.headRef
        }),
      (error: unknown) =>
        error instanceof ReviewSourceSnapshotProviderError &&
        error.operation === "resolveRef" &&
        new RegExp(testCase.missingRef, "u").test(error.message)
    );

    assert.equal(
      calls.some((call) => call.args[0] === "fetch"),
      false,
      `${testCase.name} must fail without auto-fetch`
    );
  }
});

test("LocalReviewSourceSnapshotProvider cleans up partial worktrees when snapshot creation fails after worktree add", async () => {
  const calls: GitCall[] = [];
  const provider = new LocalReviewSourceSnapshotProvider({
    createSnapshotDirectory: async () => "/tmp/nightowl-snapshot/partial",
    gitRunner: async (args, cwd, options) => {
      calls.push({ args, cwd, env: options?.env });

      if (args.join(" ") === "rev-parse --verify main^{commit}") {
        return "base-sha\n";
      }
      if (args.join(" ") === "rev-parse --verify feature^{commit}") {
        return "head-sha\n";
      }
      if (args.join(" ") === "status --porcelain=v1") {
        return "";
      }
      if (args.join(" ") === "worktree add --detach /tmp/nightowl-snapshot/partial head-sha") {
        throw new Error("worktree failed after creating metadata");
      }
      if (args.join(" ") === "worktree remove --force /tmp/nightowl-snapshot/partial") {
        return "";
      }

      throw new Error(`unexpected git call: ${args.join(" ")}`);
    }
  });

  await assert.rejects(
    () =>
      provider.createSnapshot({
        repoRoot: "/repo",
        baseRef: "main",
        headRef: "feature"
      }),
    (error: unknown) =>
      error instanceof ReviewSourceSnapshotProviderError &&
      error.operation === "createWorktree"
  );

  assert.deepEqual(calls.at(-1)?.args, [
    "worktree",
    "remove",
    "--force",
    "/tmp/nightowl-snapshot/partial"
  ]);
});

function createRunnerForDirtyStatus(statusOutput: string): SnapshotGitRunner {
  return async (args) => {
    if (args.join(" ") === "rev-parse --verify main^{commit}") {
      return "base-sha\n";
    }
    if (args.join(" ") === "rev-parse --verify feature^{commit}") {
      return "head-sha\n";
    }
    if (args.join(" ") === "status --porcelain=v1") {
      return statusOutput;
    }
    if (args.join(" ") === "worktree add --detach /tmp/nightowl-snapshot/dirty head-sha") {
      return "";
    }

    throw new Error(`unexpected git call: ${args.join(" ")}`);
  };
}
