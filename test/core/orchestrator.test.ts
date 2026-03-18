import assert from "node:assert/strict";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { ReviewOrchestrator } from "../../src/core/orchestrator.ts";
import { LocalGitProvider } from "../../src/providers/local-git-provider.ts";
import { LocalWorkspaceProvider } from "../../src/providers/local-workspace-provider.ts";
import { createReviewRepoFixture } from "../helpers/git-fixture.ts";

test("ReviewOrchestrator initializes a local review run with deterministic note paths and summary output", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");

    const orchestrator = new ReviewOrchestrator({
      sourceProvider: new LocalGitProvider(),
      outputSink: new LocalWorkspaceProvider(),
      workingDirectory: fixture.repoDir,
      timestampProvider: () => "03131430"
    });

    const result = await orchestrator.run({
      baseRef: "main",
      headRef: "feature-branch",
      repoPath: "./packages/app",
      userContext: []
    });

    const outputBaseDir = path.join(fixture.repoDir, "packages", "app");

    assert.equal(result.repoRoot, realpathSync(fixture.repoDir));
    assert.deepEqual(result.outputTarget, {
      basePath: path.join(outputBaseDir, "review", "feature-branch_03131430"),
      filesPath: path.join(
        outputBaseDir,
        "review",
        "feature-branch_03131430",
        "files"
      ),
      skippedPath: path.join(
        outputBaseDir,
        "review",
        "feature-branch_03131430",
        "skipped.md"
      )
    });
    assert.equal(result.plannedFileCount, 2);

    const nestedNotePath = path.join(
      result.outputTarget.filesPath,
      "app__index.ts.md"
    );
    const sourceNotePath = path.join(
      result.outputTarget.filesPath,
      "src__app.ts.md"
    );

    assert.equal(existsSync(result.outputTarget.basePath), true);
    assert.equal(existsSync(result.outputTarget.filesPath), true);
    assert.equal(existsSync(result.outputTarget.skippedPath), true);
    assert.equal(existsSync(nestedNotePath), true);
    assert.equal(existsSync(sourceNotePath), true);

    assert.match(readFileSync(nestedNotePath, "utf8"), /packages\/app\/index\.ts/u);
    assert.match(readFileSync(nestedNotePath, "utf8"), /not yet generated|pending/u);
    assert.match(readFileSync(sourceNotePath, "utf8"), /src\/app\.ts/u);
    assert.match(readFileSync(sourceNotePath, "utf8"), /not yet generated|pending/u);
  } finally {
    fixture.cleanup();
  }
});
