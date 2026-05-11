import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { ReviewOutputBoundaryError } from "../../src/providers/review-output-sink.ts";
import { createWorkspaceProviderFixture } from "../helpers/workspace-provider-contract-fixture.ts";

test("LocalWorkspaceProvider bootstraps run directories and truncates append-only artifacts on reinitialization", async () => {
  const fixture = createWorkspaceProviderFixture();

  try {
    const publisher = await fixture.provider.initializeRun(fixture.outputPlan);

    assert.ok(publisher, "initializeRun should yield a run-scoped output publisher");
    assert.equal(existsSync(fixture.outputTarget.basePath), true);
    assert.equal(existsSync(fixture.outputTarget.filesPath), true);
    assert.equal(fixture.readFile(fixture.outputTarget.toolAuditPath), "");
    assert.equal(existsSync(fixture.outputTarget.indexPath), false);
    assert.equal(existsSync(fixture.outputTarget.changesetOverviewPath), false);

    writeFileSync(fixture.outputTarget.toolAuditPath, "{\"stale\":true}\n");

    await fixture.provider.initializeRun(fixture.outputPlan);

    assert.equal(fixture.readFile(fixture.outputTarget.toolAuditPath), "");
  } finally {
    fixture.cleanup();
  }
});

test("LocalWorkspaceProvider wraps filesystem bootstrap failures in ReviewOutputBoundaryError", async () => {
  const fixture = createWorkspaceProviderFixture();

  try {
    mkdirSync(path.dirname(fixture.outputTarget.basePath), { recursive: true });
    writeFileSync(fixture.outputTarget.basePath, "not-a-directory");

    await assert.rejects(
      async () => fixture.provider.initializeRun(fixture.outputPlan),
      (error: unknown) => {
        assert.ok(error instanceof ReviewOutputBoundaryError);
        assert.equal(error.operation, "initializeRun");
        assert.equal(error.outputPath, fixture.outputTarget.basePath);
        assert.ok(error.cause instanceof Error);
        return true;
      }
    );
  } finally {
    fixture.cleanup();
  }
});
