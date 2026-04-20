import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import test from "node:test";

import { LocalGitProvider } from "../../src/providers/local-git-provider.ts";
import { createReviewRepoFixture } from "../helpers/git-fixture.ts";

test("LocalGitProvider wires a real repository into the stable review-source contract", async () => {
  const fixture = createReviewRepoFixture();

  try {
    const provider = new LocalGitProvider();

    assert.equal(
      await provider.resolveRepoRoot(fixture.appDir),
      realpathSync(fixture.repoDir)
    );
    assert.equal(await provider.getCurrentBranch(fixture.repoDir), "feature-branch");
    assert.deepEqual(
      await provider.getChangedFiles(fixture.repoDir, "main", "feature-branch"),
      ["dist/app.js", "packages/app/index.ts", "src/app.ts"]
    );
    assert.deepEqual(
      await provider.getChangesetEntries(fixture.repoDir, "main", "feature-branch"),
      [
        { status: "M", path: "dist/app.js" },
        { status: "D", path: "obsolete.txt" },
        { status: "M", path: "packages/app/index.ts" },
        { status: "M", path: "src/app.ts" }
      ]
    );

    const diff = await provider.getDiff(
      fixture.repoDir,
      "main",
      "feature-branch",
      "src/app.ts"
    );
    assert.match(diff, /diff --git a\/src\/app\.ts b\/src\/app\.ts/u);
    assert.match(diff, /-export const value = 1;/u);
    assert.match(diff, /\+export const value = 2;/u);
  } finally {
    fixture.cleanup();
  }
});
