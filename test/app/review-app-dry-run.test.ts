import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { createLocalReviewRunApp } from "../../src/app/review-app.ts";
import { createReviewRepoFixture } from "../helpers/git-fixture.ts";

/**
 * End-to-end dry-run integration tests.
 *
 * These tests run the full review pipeline with dryRun: true on a real
 * git repo fixture, using the production DryRunReviewSessionFactory and
 * DryRunJudgeSessionFactory. No Copilot SDK or AI API is invoked.
 *
 * Verifies:
 *  - Output folder structure matches production layout
 *  - Per-file review notes exist and contain stub content
 *  - Findings section contains "- 無" (no real findings)
 *  - summary.md lists all files as risk level None
 *  - tool-audit.jsonl exists but is empty
 *  - skipped.md exists but has no skipped file records
 *  - clientManager.start() / stop() are never called
 */
test("dry-run produces complete output folder structure without calling clientManager", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");

    let startCalls = 0;
    let stopCalls = 0;

    const app = createLocalReviewRunApp({
      workingDirectory: fixture.repoDir,
      timestampProvider: () => "03300940",
      clientManager: {
        async start() {
          startCalls += 1;
        },
        async stop() {
          stopCalls += 1;
        },
        async forceStop() {},
        getClient() {
          throw new Error("clientManager.getClient() must not be called in dry-run");
        }
      }
    });

    const result = await app.run({
      baseRef: "main",
      headRef: "feature-branch",
      repoPath: "./packages/app",
      userContext: [],
      dryRun: true
    });

    // No Copilot CLI process should have been started or stopped.
    assert.equal(startCalls, 0, "clientManager.start() must not be called in dry-run");
    assert.equal(stopCalls, 0, "clientManager.stop() must not be called in dry-run");

    // Result metadata
    assert.equal(result.dryRun, true);
    assert.equal(result.skippedFileCount, 0, "dry-run should skip no files");
    assert.ok(result.successfulFileCount > 0, "dry-run should process at least one file");

    // Output folder structure
    assert.ok(existsSync(result.outputTarget.filesPath), "files/ directory must exist");
    assert.ok(
      existsSync(result.outputTarget.changesetOverviewPath),
      "changeset-overview.md must exist"
    );
    assert.ok(existsSync(result.outputTarget.summaryPath), "summary.md must exist");
    assert.ok(existsSync(result.outputTarget.indexPath), "index.md must exist");
    assert.ok(existsSync(result.outputTarget.manifestPath), "manifest.json must exist");
    assert.ok(existsSync(result.outputTarget.toolAuditPath), "tool-audit.jsonl must exist");
    assert.ok(existsSync(result.outputTarget.skippedPath), "skipped.md must exist");

    // tool-audit.jsonl must be empty (no tools called in dry-run)
    const auditContent = readFileSync(result.outputTarget.toolAuditPath, "utf8");
    assert.equal(auditContent.trim(), "", "tool-audit.jsonl must be empty in dry-run");

    // skipped.md should have no skipped file records
    const skippedContent = readFileSync(result.outputTarget.skippedPath, "utf8");
    assert.ok(
      !skippedContent.includes("##"),
      "skipped.md should have no skipped file sections in dry-run"
    );

    // changeset-overview.md should contain stub content
    const changesetOverview = readFileSync(result.outputTarget.changesetOverviewPath, "utf8");
    assert.match(changesetOverview, /## Changeset Overview/u);

    // summary.md should show all files with risk level None
    const summaryContent = readFileSync(result.outputTarget.summaryPath, "utf8");
    assert.match(summaryContent, /None/u, "summary.md should show risk level None for all files");
    // Must not contain High/Medium/Low risk since findings is empty in dry-run
    assert.ok(
      !summaryContent.includes("- [High]") &&
        !summaryContent.includes("- [Medium]") &&
        !summaryContent.includes("- [Low]"),
      "dry-run summary should not have High/Medium/Low risk files"
    );

    // Per-file notes should contain stub sections from each step
    const files = result.runContext.changesetOverview;
    assert.match(files, /## Changeset Overview/u, "changeset overview should contain stub heading");
  } finally {
    fixture.cleanup();
  }
});

test("dry-run per-file review notes contain stub step headings", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");

    const { readFileSync: readFile, readdirSync } = await import("node:fs");

    const app = createLocalReviewRunApp({
      workingDirectory: fixture.repoDir,
      timestampProvider: () => "03300940",
      clientManager: {
        async start() {
          throw new Error("must not start in dry-run");
        },
        async stop() {},
        async forceStop() {},
        getClient() {
          throw new Error("must not get client in dry-run");
        }
      }
    });

    const result = await app.run({
      baseRef: "main",
      headRef: "feature-branch",
      repoPath: "./packages/app",
      userContext: [],
      dryRun: true
    });

    // Find any note file in the files/ directory
    const noteFiles = readdirSync(result.outputTarget.filesPath, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => `${result.outputTarget.filesPath}/${entry.name}`);

    assert.ok(noteFiles.length > 0, "there must be at least one per-file note");

    const sampleNote = readFile(noteFiles[0] ?? "", "utf8");

    // Each step should have deposited its stub heading
    const expectedHeadings = [
      "## Overview",
      "## Dependencies & Boundaries",
      "## Knowledge & Source of Truth",
      "## Strategy & What-if Scenarios",
      "## Summary"
    ];

    for (const heading of expectedHeadings) {
      assert.ok(
        sampleNote.includes(heading),
        `note must contain stub heading: ${heading}`
      );
    }

    // Findings section should indicate no findings
    assert.match(sampleNote, /## Findings/u, "note must contain ## Findings section");
    assert.match(sampleNote, /- 無/u, "Findings section should show '- 無' (no findings)");
  } finally {
    fixture.cleanup();
  }
});
