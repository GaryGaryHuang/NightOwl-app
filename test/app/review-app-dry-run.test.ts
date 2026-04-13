import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, before, after, test } from "node:test";

import { createLocalReviewRunApp } from "../../src/app/review-app.ts";
import type { ReviewRunSummary } from "../../src/core/orchestrator.ts";
import { createReviewRepoFixture, type ReviewRepoFixture } from "../helpers/git-fixture.ts";

/**
 * End-to-end dry-run integration tests.
 *
 * These tests run the full review pipeline with dryRun: true on a real
 * git repo fixture, using the production DryRunReviewSessionFactory and
 * DryRunJudgeSessionFactory. No Copilot SDK or AI API is invoked.
 *
 * Verifies:
 *  - clientManager.start() / stop() are never called
 *  - Output folder structure matches production layout
 *  - tool-audit.jsonl is empty (no SDK tool calls)
 *  - skipped.md has no skipped file records
 *  - changeset-overview.md contains stub content
 *  - summary.md lists all files as risk level None
 *  - Per-file review notes contain stub step headings and empty Findings
 */
describe("dry-run integration", () => {
  let fixture: ReviewRepoFixture;
  let result: ReviewRunSummary;
  let clientManagerStartCalls: number;
  let clientManagerStopCalls: number;

  before(async () => {
    fixture = createReviewRepoFixture();
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");

    clientManagerStartCalls = 0;
    clientManagerStopCalls = 0;

    const app = createLocalReviewRunApp({
      workingDirectory: fixture.repoDir,
      timestampProvider: () => "03300940",
      clientManager: {
        async start() {
          clientManagerStartCalls += 1;
        },
        async stop() {
          clientManagerStopCalls += 1;
        },
        async forceStop() {},
        getClient() {
          throw new Error("clientManager.getClient() must not be called in dry-run");
        }
      }
    });

    result = await app.run({
      baseRef: "main",
      headRef: "feature-branch",
      repoPath: "./packages/app",
      userContext: [],
      dryRun: true
    });
  });

  after(() => {
    fixture.cleanup();
  });

  test("clientManager lifecycle methods are never invoked", () => {
    assert.equal(clientManagerStartCalls, 0, "clientManager.start() must not be called in dry-run");
    assert.equal(clientManagerStopCalls, 0, "clientManager.stop() must not be called in dry-run");
  });

  test("result metadata reflects dry-run mode", () => {
    assert.equal(result.dryRun, true);
    assert.equal(result.skippedFileCount, 0, "dry-run should skip no files");
    assert.ok(result.successfulFileCount > 0, "dry-run should process at least one file");
  });

  test("output folder contains all required artifacts", () => {
    const { outputTarget } = result;
    assert.ok(existsSync(outputTarget.filesPath), "files/ directory must exist");
    assert.ok(existsSync(outputTarget.changesetOverviewPath), "changeset-overview.md must exist");
    assert.ok(existsSync(outputTarget.summaryPath), "summary.md must exist");
    assert.ok(existsSync(outputTarget.indexPath), "index.md must exist");
    assert.ok(existsSync(outputTarget.manifestPath), "manifest.json must exist");
    assert.ok(existsSync(outputTarget.toolAuditPath), "tool-audit.jsonl must exist");
    assert.ok(existsSync(outputTarget.skippedPath), "skipped.md must exist");
  });

  test("tool-audit.jsonl is empty (no SDK calls in dry-run)", () => {
    const content = readFileSync(result.outputTarget.toolAuditPath, "utf8");
    assert.equal(content.trim(), "", "tool-audit.jsonl must be empty in dry-run");
  });

  test("skipped.md contains no skipped file records", () => {
    const content = readFileSync(result.outputTarget.skippedPath, "utf8");
    assert.ok(!content.includes("##"), "skipped.md should have no skipped file sections in dry-run");
  });

  test("changeset-overview.md contains stub heading", () => {
    const fileContent = readFileSync(result.outputTarget.changesetOverviewPath, "utf8");
    assert.match(fileContent, /## Changeset Overview/u);
    assert.match(result.runContext.changesetOverview, /## Changeset Overview/u, "in-memory changeset overview should contain stub heading");
  });

  test("summary.md shows risk level None with no elevated risks", () => {
    const content = readFileSync(result.outputTarget.summaryPath, "utf8");
    assert.match(content, /None/u, "summary.md should show risk level None for all files");
    assert.ok(
      !content.includes("- [High]") &&
        !content.includes("- [Medium]") &&
        !content.includes("- [Low]"),
      "dry-run summary should not have High/Medium/Low risk files"
    );
  });

  test("per-file notes contain stub step headings and empty Findings", () => {
    const noteFiles = readdirSync(result.outputTarget.filesPath, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => `${result.outputTarget.filesPath}/${entry.name}`);

    assert.ok(noteFiles.length > 0, "there must be at least one per-file note");

    const sampleNote = readFileSync(noteFiles[0] ?? "", "utf8");

    const expectedHeadings = [
      "## Overview",
      "## Dependencies & Boundaries",
      "## Knowledge & Source of Truth",
      "## Strategy & What-if Scenarios",
      "## Summary"
    ];

    for (const heading of expectedHeadings) {
      assert.ok(sampleNote.includes(heading), `note must contain stub heading: ${heading}`);
    }

    assert.match(sampleNote, /## Findings/u, "note must contain ## Findings section");
    assert.match(sampleNote, /- 無/u, "Findings section should show '- 無' (no findings)");
  });
});
