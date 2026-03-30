import assert from "node:assert/strict";
import test from "node:test";

import { CliProgressReporter } from "../../src/cli/progress-reporter.ts";

test("CliProgressReporter renders an initialized metadata block and rewrites a single TTY live line", () => {
  const stdout = createFakeStdout({ isTTY: true });
  const reporter = new CliProgressReporter({ stdout });

  reporter.handleEvent({ type: "phase-changed", phase: "step0" });
  reporter.handleEvent({ type: "phase-changed", phase: "planning" });
  reporter.handleEvent({
    type: "run-initialized",
    repoRoot: "/workspace/repo",
    outputTarget: {
      basePath: "/workspace/repo/.nightowl/review/feature-branch_03131430",
      changesetOverviewPath: "/workspace/repo/.nightowl/review/feature-branch_03131430/changeset-overview.md",
      filesPath: "/workspace/repo/.nightowl/review/feature-branch_03131430/files",
      skippedPath: "/workspace/repo/.nightowl/review/feature-branch_03131430/skipped.md",
      summaryPath: "/workspace/repo/.nightowl/review/feature-branch_03131430/summary.md",
      indexPath: "/workspace/repo/.nightowl/review/feature-branch_03131430/index.md",
      manifestPath: "/workspace/repo/.nightowl/review/feature-branch_03131430/manifest.json",
      toolAuditPath: "/workspace/repo/.nightowl/review/feature-branch_03131430/tool-audit.jsonl"
    },
    plannedFileCount: 2
  });
  reporter.handleEvent({ type: "phase-changed", phase: "reviewing" });
  reporter.handleEvent({ type: "file-claimed", filePath: "src/app.ts", claimOrder: 1 });
  reporter.handleEvent({ type: "file-progressed", filePath: "src/app.ts", stepId: "step1-overview" });

  assert.equal(stdout.logs.length, 1);
  assert.equal(
    stdout.logs[0],
    "Output: /workspace/repo/.nightowl/review/feature-branch_03131430"
  );
  assert.doesNotMatch(stdout.logs[0], /Planned files:/u);
  assert.doesNotMatch(stdout.logs[0], /Review initialized\.|Repo root:/u);
  assert.ok(stdout.writes.length >= 4, "TTY mode should keep rewriting a live line");
  assert.match(stdout.writes.at(-1) ?? "", /0\/2/u);
  assert.match(stdout.writes.at(-1) ?? "", /active 1/u);
  assert.match(stdout.writes.at(-1) ?? "", /src\/app\.ts/u);
  assert.doesNotMatch(stdout.writes.at(-1) ?? "", /phase/u);
});

test("CliProgressReporter does not render a pre-planning live line before initialized metadata is available", () => {
  const stdout = createFakeStdout({ isTTY: true });
  const reporter = new CliProgressReporter({ stdout });

  reporter.handleEvent({ type: "phase-changed", phase: "step0" });
  reporter.handleEvent({ type: "phase-changed", phase: "planning" });

  assert.deepEqual(stdout.logs, []);
  assert.deepEqual(stdout.writes, []);
});

test("CliProgressReporter keeps only three most-recent active files and counts skipped files as resolved progress", () => {
  const stdout = createFakeStdout({ isTTY: true });
  const reporter = new CliProgressReporter({ stdout });

  reporter.handleEvent({
    type: "run-initialized",
    repoRoot: "/workspace/repo",
    outputTarget: {
      basePath: "/workspace/repo/.nightowl/review/feature-branch_03131430",
      changesetOverviewPath: "/workspace/repo/.nightowl/review/feature-branch_03131430/changeset-overview.md",
      filesPath: "/workspace/repo/.nightowl/review/feature-branch_03131430/files",
      skippedPath: "/workspace/repo/.nightowl/review/feature-branch_03131430/skipped.md",
      summaryPath: "/workspace/repo/.nightowl/review/feature-branch_03131430/summary.md",
      indexPath: "/workspace/repo/.nightowl/review/feature-branch_03131430/index.md",
      manifestPath: "/workspace/repo/.nightowl/review/feature-branch_03131430/manifest.json",
      toolAuditPath: "/workspace/repo/.nightowl/review/feature-branch_03131430/tool-audit.jsonl"
    },
    plannedFileCount: 5
  });
  reporter.handleEvent({ type: "phase-changed", phase: "reviewing" });

  for (const [claimOrder, filePath] of [
    [1, "src/a.ts"],
    [2, "src/b.ts"],
    [3, "src/c.ts"],
    [4, "src/d.ts"]
  ] as const) {
    reporter.handleEvent({ type: "file-claimed", filePath, claimOrder });
  }

  reporter.handleEvent({ type: "file-progressed", filePath: "src/a.ts", stepId: "step1-overview" });
  reporter.handleEvent({ type: "file-progressed", filePath: "src/c.ts", stepId: "step1-overview" });
  reporter.handleEvent({ type: "file-progressed", filePath: "src/d.ts", stepId: "step1-overview" });
  reporter.handleEvent({
    type: "file-skipped",
    filePath: "src/b.ts",
    stepId: "step2-dependencies-boundaries",
    reason: "deterministic validation failed",
    successfulFileCount: 0,
    skippedFileCount: 1
  });

  const liveLine = stdout.writes.at(-1) ?? "";

  assert.match(liveLine, /1\/5/u);
  assert.match(liveLine, /src\/d\.ts/u);
  assert.match(liveLine, /src\/c\.ts/u);
  assert.match(liveLine, /src\/a\.ts/u);
  assert.match(liveLine, /\+0 more|active 3/u);
  assert.doesNotMatch(liveLine, /src\/b\.ts/u);
});

test("CliProgressReporter keeps the TTY live line within one terminal row", () => {
  const stdout = createFakeStdout({ isTTY: true, columns: 60 });
  const reporter = new CliProgressReporter({ stdout });

  reporter.handleEvent({
    type: "run-initialized",
    repoRoot: "/workspace/repo",
    outputTarget: {
      basePath: "/workspace/repo/.nightowl/review/feature-branch_03131430",
      changesetOverviewPath: "/workspace/repo/.nightowl/review/feature-branch_03131430/changeset-overview.md",
      filesPath: "/workspace/repo/.nightowl/review/feature-branch_03131430/files",
      skippedPath: "/workspace/repo/.nightowl/review/feature-branch_03131430/skipped.md",
      summaryPath: "/workspace/repo/.nightowl/review/feature-branch_03131430/summary.md",
      indexPath: "/workspace/repo/.nightowl/review/feature-branch_03131430/index.md",
      manifestPath: "/workspace/repo/.nightowl/review/feature-branch_03131430/manifest.json",
      toolAuditPath: "/workspace/repo/.nightowl/review/feature-branch_03131430/tool-audit.jsonl"
    },
    plannedFileCount: 42
  });
  reporter.handleEvent({ type: "phase-changed", phase: "reviewing" });
  reporter.handleEvent({
    type: "file-claimed",
    filePath: "Service/src/main/java/com/kkbox/library/network/NetworkStateManager.kt",
    claimOrder: 1
  });
  reporter.handleEvent({
    type: "file-claimed",
    filePath: "Service/src/main/java/com/kkbox/library/media/util/AudioUtils.kt",
    claimOrder: 2
  });
  reporter.handleEvent({
    type: "file-claimed",
    filePath: "Service/src/main/java/com/kkbox/library/media/UnderrunTracker.kt",
    claimOrder: 3
  });
  reporter.handleEvent({
    type: "file-claimed",
    filePath: "Service/src/main/java/com/kkbox/library/media/quality/factor/datasaver/DataSaverFactor.kt",
    claimOrder: 4
  });

  const liveLine = stdout.writes.at(-1) ?? "";
  const renderedLine = liveLine.replace(/^\u001b\[2K\r/u, "");

  assert.ok(renderedLine.length <= 59, "TTY live line should fit within a single terminal row");
  assert.match(renderedLine, /^Progress 0\/42 \| active 4/u);
});

test("CliProgressReporter pins skipped-file events above the TTY live line and keeps progress at the bottom", () => {
  const stdout = createFakeStdout({ isTTY: true });
  const reporter = new CliProgressReporter({ stdout });

  reporter.handleEvent({
    type: "run-initialized",
    repoRoot: "/workspace/repo",
    outputTarget: {
      basePath: "/workspace/repo/.nightowl/review/feature-branch_03131430",
      changesetOverviewPath: "/workspace/repo/.nightowl/review/feature-branch_03131430/changeset-overview.md",
      filesPath: "/workspace/repo/.nightowl/review/feature-branch_03131430/files",
      skippedPath: "/workspace/repo/.nightowl/review/feature-branch_03131430/skipped.md",
      summaryPath: "/workspace/repo/.nightowl/review/feature-branch_03131430/summary.md",
      indexPath: "/workspace/repo/.nightowl/review/feature-branch_03131430/index.md",
      manifestPath: "/workspace/repo/.nightowl/review/feature-branch_03131430/manifest.json",
      toolAuditPath: "/workspace/repo/.nightowl/review/feature-branch_03131430/tool-audit.jsonl"
    },
    plannedFileCount: 2
  });
  reporter.handleEvent({ type: "phase-changed", phase: "reviewing" });
  reporter.handleEvent({ type: "file-claimed", filePath: "src/app.ts", claimOrder: 1 });
  reporter.handleEvent({ type: "file-claimed", filePath: "src/lib.ts", claimOrder: 2 });
  reporter.handleEvent({ type: "file-progressed", filePath: "src/lib.ts", stepId: "step1-overview" });
  reporter.handleEvent({
    type: "file-skipped",
    filePath: "src/app.ts",
    stepId: "step2-dependencies-boundaries",
    reason: "judge rejected",
    successfulFileCount: 0,
    skippedFileCount: 1
  });

  assert.match(stdout.logs.at(-1) ?? "", /Skipped: src\/app\.ts \| step2-dependencies-boundaries \| judge rejected/u);
  assert.match(stdout.writes.at(-1) ?? "", /1\/2/u);
  assert.match(stdout.writes.at(-1) ?? "", /src\/lib\.ts/u);
  assert.doesNotMatch(stdout.writes.at(-1) ?? "", /src\/app\.ts/u);
});

test("CliProgressReporter falls back to append-only snapshots when stdout is not a TTY", () => {
  const stdout = createFakeStdout({ isTTY: false });
  const reporter = new CliProgressReporter({ stdout });

  reporter.handleEvent({ type: "phase-changed", phase: "step0" });
  reporter.handleEvent({ type: "phase-changed", phase: "planning" });
  reporter.handleEvent({
    type: "run-initialized",
    repoRoot: "/workspace/repo",
    outputTarget: {
      basePath: "/workspace/repo/.nightowl/review/feature-branch_03131430",
      changesetOverviewPath: "/workspace/repo/.nightowl/review/feature-branch_03131430/changeset-overview.md",
      filesPath: "/workspace/repo/.nightowl/review/feature-branch_03131430/files",
      skippedPath: "/workspace/repo/.nightowl/review/feature-branch_03131430/skipped.md",
      summaryPath: "/workspace/repo/.nightowl/review/feature-branch_03131430/summary.md",
      indexPath: "/workspace/repo/.nightowl/review/feature-branch_03131430/index.md",
      manifestPath: "/workspace/repo/.nightowl/review/feature-branch_03131430/manifest.json",
      toolAuditPath: "/workspace/repo/.nightowl/review/feature-branch_03131430/tool-audit.jsonl"
    },
    plannedFileCount: 2
  });
  assert.deepEqual(stdout.logs, [
    "Output: /workspace/repo/.nightowl/review/feature-branch_03131430",
    "Progress 0/2 | active 0"
  ]);

  reporter.handleEvent({ type: "phase-changed", phase: "reviewing" });
  reporter.handleEvent({ type: "file-claimed", filePath: "src/app.ts", claimOrder: 1 });
  const logsBeforeOrdinaryStepProgress = stdout.logs.length;
  reporter.handleEvent({ type: "file-progressed", filePath: "src/app.ts", stepId: "step1-overview" });
  assert.equal(stdout.logs.length, logsBeforeOrdinaryStepProgress, "non-TTY mode should not append a snapshot for ordinary step progress");
  reporter.handleEvent({
    type: "file-skipped",
    filePath: "src/app.ts",
    stepId: "step2-dependencies-boundaries",
    reason: "judge rejected",
    successfulFileCount: 0,
    skippedFileCount: 1
  });

  assert.deepEqual(stdout.writes, []);
  assert.equal(stdout.logs.at(-2), "Skipped: src/app.ts | step2-dependencies-boundaries | judge rejected");
  assert.ok(stdout.logs.every((entry) => !entry.includes("\r")));
  assert.equal(stdout.logs.at(-1), "Progress 1/2 | active 0");
});

test("CliProgressReporter clears the TTY live line during finalize so the final summary does not leave a stale progress row", () => {
  const stdout = createFakeStdout({ isTTY: true });
  const reporter = new CliProgressReporter({ stdout });

  reporter.handleEvent({
    type: "run-initialized",
    repoRoot: "/workspace/repo",
    outputTarget: {
      basePath: "/workspace/repo/.nightowl/review/feature-branch_03131430",
      changesetOverviewPath: "/workspace/repo/.nightowl/review/feature-branch_03131430/changeset-overview.md",
      filesPath: "/workspace/repo/.nightowl/review/feature-branch_03131430/files",
      skippedPath: "/workspace/repo/.nightowl/review/feature-branch_03131430/skipped.md",
      summaryPath: "/workspace/repo/.nightowl/review/feature-branch_03131430/summary.md",
      indexPath: "/workspace/repo/.nightowl/review/feature-branch_03131430/index.md",
      manifestPath: "/workspace/repo/.nightowl/review/feature-branch_03131430/manifest.json",
      toolAuditPath: "/workspace/repo/.nightowl/review/feature-branch_03131430/tool-audit.jsonl"
    },
    plannedFileCount: 2
  });
  reporter.handleEvent({ type: "file-claimed", filePath: "src/app.ts", claimOrder: 1 });

  reporter.finalize();

  assert.equal(stdout.writes.at(-1), "\u001b[2K\r");
});

function createFakeStdout(options: { isTTY: boolean; columns?: number }) {
  return {
    isTTY: options.isTTY,
    columns: options.columns,
    logs: [] as string[],
    writes: [] as string[],
    log(message: unknown) {
      this.logs.push(String(message));
    },
    write(chunk: string) {
      this.writes.push(String(chunk));
      return true;
    }
  };
}