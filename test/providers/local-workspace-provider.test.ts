import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import path from "node:path";

import { LocalWorkspaceProvider } from "../../src/providers/local-workspace-provider.ts";
import { createWorkspaceProviderFixture } from "../helpers/workspace-provider-contract-fixture.ts";

test("LocalWorkspaceProvider initializes the run directories, skipped.md, and yields a run-scoped publisher", () => {
  const fixture = createWorkspaceProviderFixture();

  try {
    const publisher = fixture.provider.initializeRun(fixture.outputTarget);

    assert.equal(existsSync(fixture.outputTarget.basePath), true);
    assert.equal(existsSync(fixture.outputTarget.filesPath), true);
    assert.ok(publisher, "initializeRun should yield a run-scoped output publisher");
    // skipped.md and tool-audit.jsonl are created as empty files eagerly so
    // append operations during the run never need to create them first.
    assert.equal(existsSync(fixture.outputTarget.skippedPath), true);
    assert.equal(existsSync(fixture.outputTarget.toolAuditPath), true);
    // summary, index, manifest, and changeset-overview are written lazily
    // only when the corresponding publish method is called.
    assert.equal(existsSync(fixture.outputTarget.summaryPath), false);
    assert.equal(existsSync(fixture.outputTarget.indexPath), false);
    assert.equal(existsSync(fixture.outputTarget.manifestPath), false);
    assert.equal(existsSync(fixture.outputTarget.changesetOverviewPath), false);
    assert.equal(
      existsSync(path.join(fixture.tempDir, ".nightowl", "reviewconfig.json")),
      false
    );
    assert.equal(
      existsSync(path.join(fixture.tempDir, ".nightowl", "reviewignore")),
      false
    );
    assert.equal(fixture.readFile(fixture.outputTarget.skippedPath), "");
    assert.equal(fixture.readFile(fixture.outputTarget.toolAuditPath), "");
  } finally {
    fixture.cleanup();
  }
});

test("LocalWorkspaceProvider writes changeset overview to the correct path under basePath", () => {
  const fixture = createWorkspaceProviderFixture();

  try {
    fixture.provider.initializeRun(fixture.outputTarget);

    assert.equal(existsSync(fixture.outputTarget.changesetOverviewPath), false);
    assert.ok(
      fixture.outputTarget.changesetOverviewPath.startsWith(fixture.outputTarget.basePath),
      "changesetOverviewPath must be under basePath"
    );
    assert.ok(
      fixture.outputTarget.changesetOverviewPath.endsWith("changeset-overview.md"),
      "changesetOverviewPath must end with changeset-overview.md"
    );
  } finally {
    fixture.cleanup();
  }
});
