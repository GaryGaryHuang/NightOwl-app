import assert from "node:assert/strict";
import test from "node:test";

import {
  CliProgressReporter,
  buildActiveFileSummary,
  createProgressSnapshot,
  reduceProgressEvent,
  withActiveFileProgress,
  withResolvedOutcome
} from "../../src/cli/progress-reporter.ts";

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

test("CliProgressReporter emits a non-TTY snapshot when a file completes successfully", () => {
  const stdout = createFakeStdout({ isTTY: false });
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
  reporter.handleEvent({
    type: "file-completed",
    filePath: "src/app.ts",
    successfulFileCount: 1,
    skippedFileCount: 0
  });

  assert.deepEqual(stdout.writes, []);
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

// ─── reduceProgressEvent unit tests ───────────────────────────────────────────

const minimalOutputTarget = {
  basePath: "/out",
  changesetOverviewPath: "/out/changeset-overview.md",
  filesPath: "/out/files",
  skippedPath: "/out/skipped.md",
  summaryPath: "/out/summary.md",
  indexPath: "/out/index.md",
  manifestPath: "/out/manifest.json",
  toolAuditPath: "/out/tool-audit.jsonl"
};

function makeEmptyState() {
  return {
    activeFiles: new Map<string, { claimOrder: number; lastProgressSeq: number }>(),
    eventSeq: 0,
    skippedFileCount: 0,
    successfulFileCount: 0
  };
}

test("reduceProgressEvent: phase-changed returns empty instruction and same state reference", () => {
  const state = makeEmptyState();
  const result = reduceProgressEvent(state, { type: "phase-changed", phase: "step0" });

  assert.deepEqual(result.instruction, {});
  assert.equal(result.state, state);
});

test("reduceProgressEvent: run-initialized returns appendMessage and significant renderProgress", () => {
  const state = makeEmptyState();
  const result = reduceProgressEvent(state, {
    type: "run-initialized",
    repoRoot: "/repo",
    outputTarget: minimalOutputTarget,
    plannedFileCount: 3
  });

  assert.equal(result.instruction.appendMessage, "Output: /out");
  assert.deepEqual(result.instruction.renderProgress, { significant: true });
  assert.equal(result.state.plannedFileCount, 3);
});

test("reduceProgressEvent: file-claimed returns non-significant renderProgress and adds file to activeFiles", () => {
  const state = makeEmptyState();
  const result = reduceProgressEvent(state, { type: "file-claimed", filePath: "src/a.ts", claimOrder: 1 });

  assert.deepEqual(result.instruction, { renderProgress: { significant: false } });
  assert.ok(result.state.activeFiles.has("src/a.ts"));
  assert.equal(result.state.activeFiles.get("src/a.ts")?.claimOrder, 1);
});

test("reduceProgressEvent: file-progressed for known file preserves existing claimOrder and updates lastProgressSeq", () => {
  let state = makeEmptyState();
  state = reduceProgressEvent(state, { type: "file-claimed", filePath: "src/a.ts", claimOrder: 2 }).state;
  const seqBefore = state.activeFiles.get("src/a.ts")?.lastProgressSeq ?? 0;

  const result = reduceProgressEvent(state, { type: "file-progressed", filePath: "src/a.ts", stepId: "step1-overview" });

  assert.deepEqual(result.instruction, { renderProgress: { significant: false } });
  assert.equal(result.state.activeFiles.get("src/a.ts")?.claimOrder, 2);
  assert.ok((result.state.activeFiles.get("src/a.ts")?.lastProgressSeq ?? 0) > seqBefore);
});

test("reduceProgressEvent: file-progressed for unknown filePath uses MAX_SAFE_INTEGER as fallback claimOrder", () => {
  const state = makeEmptyState();
  const result = reduceProgressEvent(state, { type: "file-progressed", filePath: "src/unknown.ts", stepId: "step1-overview" });

  assert.equal(result.state.activeFiles.get("src/unknown.ts")?.claimOrder, Number.MAX_SAFE_INTEGER);
});

test("reduceProgressEvent: file-completed returns significant renderProgress and removes file from activeFiles", () => {
  let state = makeEmptyState();
  state = reduceProgressEvent(state, { type: "file-claimed", filePath: "src/a.ts", claimOrder: 1 }).state;

  const result = reduceProgressEvent(state, {
    type: "file-completed",
    filePath: "src/a.ts",
    successfulFileCount: 1,
    skippedFileCount: 0
  });

  assert.deepEqual(result.instruction, { renderProgress: { significant: true } });
  assert.ok(!result.state.activeFiles.has("src/a.ts"));
  assert.equal(result.state.successfulFileCount, 1);
});

test("reduceProgressEvent: file-skipped returns appendMessage with details and removes file from activeFiles", () => {
  let state = makeEmptyState();
  state = reduceProgressEvent(state, { type: "file-claimed", filePath: "src/b.ts", claimOrder: 1 }).state;

  const result = reduceProgressEvent(state, {
    type: "file-skipped",
    filePath: "src/b.ts",
    stepId: "step2",
    reason: "judge rejected",
    successfulFileCount: 0,
    skippedFileCount: 1
  });

  assert.equal(result.instruction.appendMessage, "Skipped: src/b.ts | step2 | judge rejected");
  assert.deepEqual(result.instruction.renderProgress, { significant: true });
  assert.ok(!result.state.activeFiles.has("src/b.ts"));
});

test("reduceProgressEvent: run-finalizing returns significant renderProgress and updates all counters", () => {
  const state = makeEmptyState();
  const result = reduceProgressEvent(state, {
    type: "run-finalizing",
    plannedFileCount: 5,
    successfulFileCount: 3,
    skippedFileCount: 1
  });

  assert.deepEqual(result.instruction, { renderProgress: { significant: true } });
  assert.equal(result.state.plannedFileCount, 5);
  assert.equal(result.state.successfulFileCount, 3);
  assert.equal(result.state.skippedFileCount, 1);
});

test("reduceProgressEvent: unknown event type returns empty instruction and same state reference", () => {
  const state = makeEmptyState();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = reduceProgressEvent(state, { type: "never-known-event" } as any);

  assert.deepEqual(result.instruction, {});
  assert.equal(result.state, state);
});

// ─── withActiveFileProgress unit tests ────────────────────────────────────────

test("withActiveFileProgress: adds a new file entry with correct claimOrder and lastProgressSeq", () => {
  const state = makeEmptyState();
  const result = withActiveFileProgress(state, "src/a.ts", 5);

  assert.ok(result.activeFiles.has("src/a.ts"));
  assert.equal(result.activeFiles.get("src/a.ts")?.claimOrder, 5);
  assert.equal(result.activeFiles.get("src/a.ts")?.lastProgressSeq, result.eventSeq);
  assert.equal(result.eventSeq, state.eventSeq + 1);
});

test("withActiveFileProgress: updates lastProgressSeq of an existing entry using the passed claimOrder", () => {
  const state = makeEmptyState();
  const after1 = withActiveFileProgress(state, "src/a.ts", 2);
  const after2 = withActiveFileProgress(after1, "src/a.ts", 99);

  assert.ok((after2.activeFiles.get("src/a.ts")?.lastProgressSeq ?? 0) > (after1.activeFiles.get("src/a.ts")?.lastProgressSeq ?? 0));
  assert.equal(after2.activeFiles.get("src/a.ts")?.claimOrder, 99);
});

test("withActiveFileProgress: increments eventSeq by 1 on every call", () => {
  const s0 = makeEmptyState();
  const s1 = withActiveFileProgress(s0, "src/a.ts", 1);
  const s2 = withActiveFileProgress(s1, "src/b.ts", 2);

  assert.equal(s1.eventSeq, s0.eventSeq + 1);
  assert.equal(s2.eventSeq, s1.eventSeq + 1);
});

// ─── withResolvedOutcome unit tests ───────────────────────────────────────────

test("withResolvedOutcome: removes file from activeFiles and updates successfulFileCount and skippedFileCount", () => {
  let state = makeEmptyState();
  state = withActiveFileProgress(state, "src/a.ts", 1);

  const result = withResolvedOutcome(state, "src/a.ts", 2, 1);

  assert.ok(!result.activeFiles.has("src/a.ts"));
  assert.equal(result.successfulFileCount, 2);
  assert.equal(result.skippedFileCount, 1);
});

// ─── createProgressSnapshot unit tests ────────────────────────────────────────

test("createProgressSnapshot: resolvedFileCount is sum of successfulFileCount and skippedFileCount", () => {
  let state = makeEmptyState();
  state = withActiveFileProgress(state, "src/a.ts", 1);
  state = withActiveFileProgress(state, "src/b.ts", 2);
  const stateWithCounts = { ...state, successfulFileCount: 2, skippedFileCount: 1 };

  const snapshot = createProgressSnapshot(stateWithCounts);

  assert.equal(snapshot.resolvedFileCount, 3);
  assert.equal(snapshot.activeFileCount, 2);
});

// ─── buildActiveFileSummary unit tests ────────────────────────────────────────

test("buildActiveFileSummary: returns empty string for empty map", () => {
  const result = buildActiveFileSummary(new Map());

  assert.equal(result, "");
});

test("buildActiveFileSummary: returns single path for a one-entry map", () => {
  const files = new Map([["src/a.ts", { claimOrder: 1, lastProgressSeq: 1 }]]);

  assert.equal(buildActiveFileSummary(files), "src/a.ts");
});

test("buildActiveFileSummary: returns comma-separated list with no +N more for two entries", () => {
  const files = new Map([
    ["src/a.ts", { claimOrder: 1, lastProgressSeq: 1 }],
    ["src/b.ts", { claimOrder: 2, lastProgressSeq: 2 }]
  ]);
  const result = buildActiveFileSummary(files);

  assert.ok(result.includes("src/a.ts"));
  assert.ok(result.includes("src/b.ts"));
  assert.doesNotMatch(result, /\+\d+ more/u);
});

test("buildActiveFileSummary: shows at most three files and appends +N more for five entries", () => {
  const files = new Map([
    ["src/a.ts", { claimOrder: 1, lastProgressSeq: 1 }],
    ["src/b.ts", { claimOrder: 2, lastProgressSeq: 2 }],
    ["src/c.ts", { claimOrder: 3, lastProgressSeq: 3 }],
    ["src/d.ts", { claimOrder: 4, lastProgressSeq: 4 }],
    ["src/e.ts", { claimOrder: 5, lastProgressSeq: 5 }]
  ]);
  const result = buildActiveFileSummary(files);
  const pathMatches = result.match(/src\//gu) ?? [];

  assert.equal(pathMatches.length, 3);
  assert.match(result, /\| \+2 more$/u);
});

test("buildActiveFileSummary: sorts by lastProgressSeq descending (most recent activity first)", () => {
  const files = new Map([
    ["src/a.ts", { claimOrder: 1, lastProgressSeq: 1 }],
    ["src/b.ts", { claimOrder: 2, lastProgressSeq: 5 }],
    ["src/c.ts", { claimOrder: 3, lastProgressSeq: 3 }]
  ]);
  const result = buildActiveFileSummary(files);
  const posB = result.indexOf("src/b.ts");
  const posC = result.indexOf("src/c.ts");
  const posA = result.indexOf("src/a.ts");

  assert.ok(posB < posC, "b (seq=5) should come before c (seq=3)");
  assert.ok(posC < posA, "c (seq=3) should come before a (seq=1)");
});

test("buildActiveFileSummary: uses claimOrder ascending as tiebreaker when lastProgressSeq is equal", () => {
  const files = new Map([
    ["src/late-claim.ts", { claimOrder: 3, lastProgressSeq: 10 }],
    ["src/early-claim.ts", { claimOrder: 1, lastProgressSeq: 10 }]
  ]);
  const result = buildActiveFileSummary(files);
  const posEarly = result.indexOf("src/early-claim.ts");
  const posLate = result.indexOf("src/late-claim.ts");

  assert.ok(posEarly < posLate, "early-claim (order=1) should come before late-claim (order=3)");
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
