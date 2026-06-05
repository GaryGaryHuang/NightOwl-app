import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, before, after, test } from "node:test";

import { createLocalReviewRunApp } from "../../src/app/review-app.ts";
import type { ReviewRunSummary } from "../../src/core/orchestrator.ts";
import type { RunProgressEvent } from "../../src/core/run-progress.ts";
import { createReviewRepoFixture, type ReviewRepoFixture } from "../helpers/git-fixture.ts";

/**
 * Dry-run integration tests.
 *
 * These tests run the full review pipeline with dryRun: true on a real
 * git repo fixture, using the production dry-run session factory path.
 * No Copilot SDK or AI API is invoked.
 *
 * Verifies only happy-path dry-run behavior:
 *  - clientManager.start() / stop() are never called
 *  - Output folder structure matches production layout
 *  - tool-audit.jsonl is empty (no SDK tool calls)
 */
describe("dry-run integration", () => {
  let fixture: ReviewRepoFixture;
  let result: ReviewRunSummary;
  let clientManagerStartCalls: number;
  let clientManagerStopCalls: number;
  const events: RunProgressEvent[] = [];

  before(async () => {
    fixture = createReviewRepoFixture();
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");
    fixture.writeFile(".nightowl/reviewconfig.json", "{\"maxConcurrentFiles\":1}\n");
    fixture.commitAll("add nightowl config");
    fixture.writeFile(".nightowl/reviewignore", "\n");

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
          return [];
        },
        async forceStop() {},
        getClient() {
          throw new Error("clientManager.getClient() must not be called in dry-run");
        }
      },
      onProgressEvent(event) {
        events.push(event);
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
    assert.equal(
      result.successfulFileCount,
      3,
      "dry-run should apply live repo-local reviewignore while reviewing committed source content"
    );
  });

  test("output folder contains all required artifacts", () => {
    const { outputTarget } = result;
    assert.ok(existsSync(outputTarget.filesPath), "files/ directory must exist");
    assert.ok(existsSync(outputTarget.changesetOverviewPath), "changeset-overview.md must exist");
    assert.ok(existsSync(outputTarget.indexPath), "index.md must exist");
    assert.ok(existsSync(outputTarget.toolAuditPath), "tool-audit.jsonl must exist");
  });

  test("tool-audit.jsonl is empty (no SDK calls in dry-run)", () => {
    const content = readFileSync(result.outputTarget.toolAuditPath, "utf8");
    assert.equal(content.trim(), "", "tool-audit.jsonl must be empty in dry-run");
  });

  test("dry-run applies repo-local reviewignore while warning about source snapshot review", () => {
    const noteFiles = readdirSync(result.outputTarget.filesPath);

    assert.ok(
      noteFiles.some((fileName) => fileName.includes("app.ts")),
      "expected source file notes"
    );
    assert.equal(
      noteFiles.some((fileName) => fileName.includes("dist")),
      true,
      "live repo-local reviewignore changes should affect file planning"
    );
    assert.ok(
      events.some(
        (event) =>
          event.type === "run-warning" &&
          /source review uses the resolved head snapshot/iu.test(event.message) &&
          /runtime config is read from the working tree/iu.test(event.message)
      ),
      "dirty working tree should describe source snapshot and runtime config behavior"
    );
  });

});
