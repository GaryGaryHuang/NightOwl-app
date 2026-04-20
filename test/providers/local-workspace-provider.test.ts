import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import test from "node:test";
import path from "node:path";

import { LocalWorkspaceProvider } from "../../src/providers/local-workspace-provider.ts";
import { createWorkspaceProviderFixture } from "../helpers/workspace-provider-contract-fixture.ts";

test("LocalWorkspaceProvider initializes the run directories, skipped.md, and yields a run-scoped publisher", async () => {
  const fixture = createWorkspaceProviderFixture();

  try {
    const publisher = await fixture.provider.initializeRun(fixture.outputPlan);

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
    assert.equal(existsSync(fixture.outputTarget.verifierReportPath), false);
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

test("LocalWorkspaceProvider keeps changeset overview lazy under the run basePath", async () => {
  const fixture = createWorkspaceProviderFixture();

  try {
    await fixture.provider.initializeRun(fixture.outputPlan);

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

test("LocalWorkspaceProvider re-initializing a run truncates skipped.md and tool-audit.jsonl while preserving directories", async () => {
  const fixture = createWorkspaceProviderFixture();

  try {
    await fixture.provider.initializeRun(fixture.outputPlan);
    writeFileSync(fixture.outputTarget.skippedPath, "stale skip line\n");
    writeFileSync(fixture.outputTarget.toolAuditPath, '{"stale":true}\n');

    await fixture.provider.initializeRun(fixture.outputPlan);

    assert.equal(existsSync(fixture.outputTarget.basePath), true);
    assert.equal(existsSync(fixture.outputTarget.filesPath), true);
    assert.equal(fixture.readFile(fixture.outputTarget.skippedPath), "");
    assert.equal(fixture.readFile(fixture.outputTarget.toolAuditPath), "");
  } finally {
    fixture.cleanup();
  }
});

test("LocalWorkspaceProvider yields a run-scoped publisher whose publishRunManifest writes to the bootstrapped manifestPath", async () => {
  const fixture = createWorkspaceProviderFixture();

  try {
    const publisher = await fixture.provider.initializeRun(fixture.outputPlan);
    assert.equal(existsSync(fixture.outputTarget.manifestPath), false);

    await publisher.publishRunManifest({ content: '{\n  "schemaVersion": 1\n}' });

    assert.equal(
      fixture.outputTarget.manifestPath.startsWith(fixture.outputTarget.basePath),
      true,
      "manifestPath must be under basePath"
    );
    assert.equal(
      fixture.readFile(fixture.outputTarget.manifestPath),
      '{\n  "schemaVersion": 1\n}'
    );
  } finally {
    fixture.cleanup();
  }
});

test("LocalWorkspaceProvider keeps verifier-report lazy under the run basePath", async () => {
  const fixture = createWorkspaceProviderFixture();

  try {
    await fixture.provider.initializeRun(fixture.outputPlan);

    assert.equal(existsSync(fixture.outputTarget.verifierReportPath), false);
    assert.ok(
      fixture.outputTarget.verifierReportPath.startsWith(fixture.outputTarget.basePath),
      "verifierReportPath must be under basePath"
    );
    assert.ok(
      fixture.outputTarget.verifierReportPath.endsWith("verifier-report.jsonl"),
      "verifierReportPath must end with verifier-report.jsonl"
    );
  } finally {
    fixture.cleanup();
  }
});
