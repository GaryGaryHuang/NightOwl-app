import assert from "node:assert/strict";
import test from "node:test";

import { CliProgressReporter } from "../../src/cli/progress-reporter.ts";
import { createOutputTarget } from "../helpers/completed-run-finalizer-contract-fixture.ts";

const CLEAR_TTY_LIVE_LINE = "\u001b[2K\r";
const REPO_ROOT = "/workspace/repo";
const REVIEW_BASE_PATH =
  "/workspace/repo/.nightowl/review/feature-branch_03131430";
const STEP1 = "step1-overview";

type FakeStdout = ReturnType<typeof createFakeStdout>;

test("CliProgressReporter renders an initialized metadata block and rewrites a single TTY live line", () => {
  const { stdout, reporter } = createInitializedReporter({
    isTTY: true,
    plannedFileCount: 2
  });

  reporter.handleEvent({ type: "phase-changed", phase: "reviewing" });
  reporter.handleEvent({
    type: "file-claimed",
    filePath: "src/app.ts",
    claimOrder: 1
  });
  reporter.handleEvent({
    type: "file-progressed",
    filePath: "src/app.ts",
    stepId: STEP1
  });

  assert.deepEqual(stdout.logs, [`Output: ${REVIEW_BASE_PATH}`]);
  assert.doesNotMatch(stdout.logs[0] ?? "", /Planned files:/u);
  assert.doesNotMatch(stdout.logs[0] ?? "", /Review initialized\.|Repo root:/u);
  assert.ok(
    stdout.writes.length >= 3,
    "TTY mode should keep rewriting a live line"
  );
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
  const { stdout, reporter } = createInitializedReporter({
    isTTY: true,
    plannedFileCount: 5
  });

  reporter.handleEvent({ type: "phase-changed", phase: "reviewing" });
  claimFiles(reporter, [
    [1, "src/a.ts"],
    [2, "src/b.ts"],
    [3, "src/c.ts"],
    [4, "src/d.ts"]
  ]);
  progressFiles(reporter, ["src/a.ts", "src/c.ts", "src/d.ts"]);
  reporter.handleEvent({
    type: "file-skipped",
    filePath: "src/b.ts",
    stepId: "step2-dependencies-boundaries",
    reason: "deterministic validation failed"
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
  const { stdout, reporter } = createInitializedReporter({
    isTTY: true,
    columns: 60,
    plannedFileCount: 42
  });

  reporter.handleEvent({ type: "phase-changed", phase: "reviewing" });
  claimFiles(reporter, [
    [
      1,
      "Service/src/main/java/com/kkbox/library/network/NetworkStateManager.kt"
    ],
    [2, "Service/src/main/java/com/kkbox/library/media/util/AudioUtils.kt"],
    [3, "Service/src/main/java/com/kkbox/library/media/UnderrunTracker.kt"],
    [
      4,
      "Service/src/main/java/com/kkbox/library/media/quality/factor/datasaver/DataSaverFactor.kt"
    ]
  ]);

  const liveLine = stdout.writes.at(-1) ?? "";
  const renderedLine = liveLine.replace(/^\u001b\[2K\r/u, "");

  assert.ok(
    renderedLine.length <= 59,
    "TTY live line should fit within a single terminal row"
  );
  assert.match(renderedLine, /^Progress 0\/42 \| active 4/u);
});

test("CliProgressReporter pins skipped-file events above the TTY live line and keeps progress at the bottom", () => {
  const { stdout, reporter } = createInitializedReporter({
    isTTY: true,
    plannedFileCount: 2
  });

  reporter.handleEvent({ type: "phase-changed", phase: "reviewing" });
  claimFiles(reporter, [
    [1, "src/app.ts"],
    [2, "src/lib.ts"]
  ]);
  progressFiles(reporter, ["src/lib.ts"]);
  reporter.handleEvent({
    type: "file-skipped",
    filePath: "src/app.ts",
    stepId: "step2-dependencies-boundaries",
    reason: "judge rejected"
  });

  assert.match(
    stdout.logs.at(-1) ?? "",
    /Skipped: src\/app\.ts \| step2-dependencies-boundaries \| judge rejected/u
  );
  assert.match(stdout.writes.at(-1) ?? "", /1\/2/u);
  assert.match(stdout.writes.at(-1) ?? "", /src\/lib\.ts/u);
  assert.doesNotMatch(stdout.writes.at(-1) ?? "", /src\/app\.ts/u);
});

test("CliProgressReporter pins tool-audit warnings above the TTY live line and keeps progress at the bottom", () => {
  const { stdout, reporter } = createInitializedReporter({
    isTTY: true,
    plannedFileCount: 2
  });

  reporter.handleEvent({ type: "phase-changed", phase: "reviewing" });
  reporter.handleEvent({
    type: "file-claimed",
    filePath: "src/app.ts",
    claimOrder: 1
  });
  reporter.handleEvent({
    type: "tool-audit-write-failed",
    message: "tool-audit.jsonl write failed at /workspace/repo/.nightowl/review/run/tool-audit.jsonl: EISDIR"
  });

  assert.match(
    stdout.logs.at(-1) ?? "",
    /Warning: tool-audit\.jsonl write failed at .*tool-audit\.jsonl: EISDIR/u
  );
  assert.match(stdout.writes.at(-1) ?? "", /0\/2/u);
  assert.match(stdout.writes.at(-1) ?? "", /src\/app\.ts/u);
});

test("CliProgressReporter falls back to append-only snapshots when stdout is not a TTY", () => {
  const { stdout, reporter } = createInitializedReporter({
    isTTY: false,
    plannedFileCount: 2
  });

  assert.deepEqual(stdout.logs, [
    `Output: ${REVIEW_BASE_PATH}`,
    "Progress 0/2 | active 0"
  ]);

  reporter.handleEvent({ type: "phase-changed", phase: "reviewing" });
  reporter.handleEvent({
    type: "file-claimed",
    filePath: "src/app.ts",
    claimOrder: 1
  });

  const logsBeforeOrdinaryStepProgress = stdout.logs.length;
  reporter.handleEvent({
    type: "file-progressed",
    filePath: "src/app.ts",
    stepId: STEP1
  });
  assert.equal(
    stdout.logs.length,
    logsBeforeOrdinaryStepProgress,
    "non-TTY mode should not append a snapshot for ordinary step progress"
  );

  reporter.handleEvent({
    type: "file-skipped",
    filePath: "src/app.ts",
    stepId: "step2-dependencies-boundaries",
    reason: "judge rejected"
  });

  assert.deepEqual(stdout.writes, []);
  assert.equal(
    stdout.logs.at(-2),
    "Skipped: src/app.ts | step2-dependencies-boundaries | judge rejected"
  );
  assert.ok(stdout.logs.every((entry) => !entry.includes("\r")));
  assert.equal(stdout.logs.at(-1), "Progress 1/2 | active 0");
});

test("CliProgressReporter emits a non-TTY snapshot when a file completes successfully", () => {
  const { stdout, reporter } = createInitializedReporter({
    isTTY: false,
    plannedFileCount: 2
  });

  reporter.handleEvent({
    type: "file-claimed",
    filePath: "src/app.ts",
    claimOrder: 1
  });
  reporter.handleEvent({
    type: "file-completed",
    filePath: "src/app.ts"
  });

  assert.deepEqual(stdout.writes, []);
  assert.equal(stdout.logs.at(-1), "Progress 1/2 | active 0");
});

test("CliProgressReporter renders a final non-TTY snapshot using the counts carried by run-finalizing", () => {
  const { stdout, reporter } = createInitializedReporter({
    isTTY: false,
    plannedFileCount: 2
  });

  reporter.handleEvent({
    type: "run-finalizing",
    plannedFileCount: 4,
    successfulFileCount: 3,
    skippedFileCount: 1
  });

  assert.equal(stdout.logs.at(-1), "Progress 4/4 | active 0");
});

test("CliProgressReporter appends tool-audit warnings in non-TTY mode without affecting progress state", () => {
  const { stdout, reporter } = createInitializedReporter({
    isTTY: false,
    plannedFileCount: 2
  });

  reporter.handleEvent({
    type: "tool-audit-write-failed",
    message: "tool-audit.jsonl write failed at /workspace/repo/.nightowl/review/run/tool-audit.jsonl: EISDIR"
  });

  assert.deepEqual(stdout.writes, []);
  assert.equal(
    stdout.logs.at(-1),
    "Warning: tool-audit.jsonl write failed at /workspace/repo/.nightowl/review/run/tool-audit.jsonl: EISDIR"
  );
  assert.equal(stdout.logs.at(-2), "Progress 0/2 | active 0");
});

test("CliProgressReporter clears the TTY live line during finalize so the final summary does not leave a stale progress row", () => {
  const { stdout, reporter } = createInitializedReporter({
    isTTY: true,
    plannedFileCount: 2
  });

  reporter.handleEvent({
    type: "file-claimed",
    filePath: "src/app.ts",
    claimOrder: 1
  });

  reporter.finalize();

  assert.equal(stdout.writes.at(-1), CLEAR_TTY_LIVE_LINE);
});

test("CliProgressReporter warns on unsupported progress event types instead of silently ignoring them", () => {
  const { stdout, reporter } = createInitializedReporter({
    isTTY: false,
    plannedFileCount: 1
  });

  reporter.handleEvent(
    {
      type: "future-unsupported-event"
    } as unknown as Parameters<CliProgressReporter["handleEvent"]>[0]
  );

  assert.match(
    stdout.logs.at(-1) ?? "",
    /warning: cliprogressreporter ignored unsupported progress event type/iu
  );
});

function createInitializedReporter(options: {
  columns?: number;
  isTTY: boolean;
  plannedFileCount: number;
}): { stdout: FakeStdout; reporter: CliProgressReporter } {
  const stdout = createFakeStdout(options);
  const reporter = new CliProgressReporter({ stdout });

  reporter.handleEvent({ type: "phase-changed", phase: "step0" });
  reporter.handleEvent({ type: "phase-changed", phase: "planning" });
  reporter.handleEvent({
    type: "run-initialized",
    repoRoot: REPO_ROOT,
    outputTarget: createOutputTarget({ basePath: REVIEW_BASE_PATH }),
    plannedFileCount: options.plannedFileCount
  });

  return { stdout, reporter };
}

function claimFiles(
  reporter: CliProgressReporter,
  files: Array<readonly [claimOrder: number, filePath: string]>
): void {
  for (const [claimOrder, filePath] of files) {
    reporter.handleEvent({ type: "file-claimed", filePath, claimOrder });
  }
}

function progressFiles(
  reporter: CliProgressReporter,
  filePaths: string[]
): void {
  for (const filePath of filePaths) {
    reporter.handleEvent({ type: "file-progressed", filePath, stepId: STEP1 });
  }
}

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
