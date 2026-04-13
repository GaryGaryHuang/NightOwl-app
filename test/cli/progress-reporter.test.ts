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
import { createOutputTarget } from "../helpers/completed-run-finalizer-contract-fixture.ts";

const CLEAR_TTY_LIVE_LINE = "\u001b[2K\r";
const REPO_ROOT = "/workspace/repo";
const REVIEW_BASE_PATH =
  "/workspace/repo/.nightowl/review/feature-branch_03131430";
const STEP1 = "step1-overview";

type ProgressState = Parameters<typeof reduceProgressEvent>[0];
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
    reason: "judge rejected",
    successfulFileCount: 0,
    skippedFileCount: 1
  });

  assert.match(
    stdout.logs.at(-1) ?? "",
    /Skipped: src\/app\.ts \| step2-dependencies-boundaries \| judge rejected/u
  );
  assert.match(stdout.writes.at(-1) ?? "", /1\/2/u);
  assert.match(stdout.writes.at(-1) ?? "", /src\/lib\.ts/u);
  assert.doesNotMatch(stdout.writes.at(-1) ?? "", /src\/app\.ts/u);
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
    reason: "judge rejected",
    successfulFileCount: 0,
    skippedFileCount: 1
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
    filePath: "src/app.ts",
    successfulFileCount: 1,
    skippedFileCount: 0
  });

  assert.deepEqual(stdout.writes, []);
  assert.equal(stdout.logs.at(-1), "Progress 1/2 | active 0");
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

test("reduceProgressEvent maps run progress events to state updates and render instructions", () => {
  const cases: Array<{
    name: string;
    setupState?: () => ProgressState;
    event: Parameters<typeof reduceProgressEvent>[1];
    verify(result: ReturnType<typeof reduceProgressEvent>): void;
  }> = [
    {
      name: "phase-changed is ignored",
      event: { type: "phase-changed", phase: "step0" },
      verify(result) {
        assert.deepEqual(result.instruction, {});
      }
    },
    {
      name: "run-initialized appends output and stores planned count",
      event: {
        type: "run-initialized",
        repoRoot: "/repo",
        outputTarget: createOutputTarget({ basePath: "/out" }),
        plannedFileCount: 3
      },
      verify(result) {
        assert.equal(result.instruction.appendMessage, "Output: /out");
        assert.deepEqual(result.instruction.renderProgress, { significant: true });
        assert.equal(result.state.plannedFileCount, 3);
      }
    },
    {
      name: "file-claimed adds an active file",
      event: { type: "file-claimed", filePath: "src/a.ts", claimOrder: 1 },
      verify(result) {
        assert.deepEqual(result.instruction, {
          renderProgress: { significant: false }
        });
        assert.equal(result.state.activeFiles.get("src/a.ts")?.claimOrder, 1);
      }
    },
    {
      name: "file-progressed preserves known claim order",
      setupState() {
        return reduceProgressEvent(makeEmptyState(), {
          type: "file-claimed",
          filePath: "src/a.ts",
          claimOrder: 2
        }).state;
      },
      event: { type: "file-progressed", filePath: "src/a.ts", stepId: STEP1 },
      verify(result) {
        assert.deepEqual(result.instruction, {
          renderProgress: { significant: false }
        });
        assert.equal(result.state.activeFiles.get("src/a.ts")?.claimOrder, 2);
      }
    },
    {
      name: "file-progressed creates unknown file fallback",
      event: {
        type: "file-progressed",
        filePath: "src/unknown.ts",
        stepId: STEP1
      },
      verify(result) {
        assert.equal(
          result.state.activeFiles.get("src/unknown.ts")?.claimOrder,
          Number.MAX_SAFE_INTEGER
        );
      }
    },
    {
      name: "file-completed removes active file and stores counters",
      setupState() {
        return reduceProgressEvent(makeEmptyState(), {
          type: "file-claimed",
          filePath: "src/a.ts",
          claimOrder: 1
        }).state;
      },
      event: {
        type: "file-completed",
        filePath: "src/a.ts",
        successfulFileCount: 1,
        skippedFileCount: 0
      },
      verify(result) {
        assert.deepEqual(result.instruction, {
          renderProgress: { significant: true }
        });
        assert.ok(!result.state.activeFiles.has("src/a.ts"));
        assert.equal(result.state.successfulFileCount, 1);
      }
    },
    {
      name: "file-skipped appends a skipped message and removes active file",
      setupState() {
        return reduceProgressEvent(makeEmptyState(), {
          type: "file-claimed",
          filePath: "src/b.ts",
          claimOrder: 1
        }).state;
      },
      event: {
        type: "file-skipped",
        filePath: "src/b.ts",
        stepId: "step2",
        reason: "judge rejected",
        successfulFileCount: 0,
        skippedFileCount: 1
      },
      verify(result) {
        assert.equal(
          result.instruction.appendMessage,
          "Skipped: src/b.ts | step2 | judge rejected"
        );
        assert.deepEqual(result.instruction.renderProgress, { significant: true });
        assert.ok(!result.state.activeFiles.has("src/b.ts"));
      }
    },
    {
      name: "run-finalizing updates all counters",
      event: {
        type: "run-finalizing",
        plannedFileCount: 5,
        successfulFileCount: 3,
        skippedFileCount: 1
      },
      verify(result) {
        assert.deepEqual(result.instruction, {
          renderProgress: { significant: true }
        });
        assert.equal(result.state.plannedFileCount, 5);
        assert.equal(result.state.successfulFileCount, 3);
        assert.equal(result.state.skippedFileCount, 1);
      }
    }
  ];

  for (const { name, setupState, event, verify } of cases) {
    verify(reduceProgressEvent(setupState?.() ?? makeEmptyState(), event));
  }
});

test("reduceProgressEvent returns an empty instruction and same state for unknown event types", () => {
  const state = makeEmptyState();
  const result = reduceProgressEvent(state, { type: "never-known-event" } as never);

  assert.deepEqual(result.instruction, {});
  assert.equal(result.state, state);
});

test("progress state helpers update active and resolved counters", () => {
  const s0 = makeEmptyState();
  const s1 = withActiveFileProgress(s0, "src/a.ts", 1);
  const s2 = withActiveFileProgress(s1, "src/b.ts", 2);
  const s3 = withActiveFileProgress(s2, "src/a.ts", 99);
  const s4 = withResolvedOutcome(s3, "src/a.ts", 2, 1);

  assert.equal(s1.eventSeq, s0.eventSeq + 1);
  assert.equal(s2.eventSeq, s1.eventSeq + 1);
  assert.equal(s3.eventSeq, s2.eventSeq + 1);
  assert.equal(s3.activeFiles.get("src/a.ts")?.claimOrder, 99);
  assert.ok(
    (s3.activeFiles.get("src/a.ts")?.lastProgressSeq ?? 0) >
      (s1.activeFiles.get("src/a.ts")?.lastProgressSeq ?? 0)
  );
  assert.ok(!s4.activeFiles.has("src/a.ts"));
  assert.equal(s4.successfulFileCount, 2);
  assert.equal(s4.skippedFileCount, 1);
});

test("createProgressSnapshot summarizes active and resolved file counts", () => {
  let state = makeEmptyState();
  state = withActiveFileProgress(state, "src/a.ts", 1);
  state = withActiveFileProgress(state, "src/b.ts", 2);
  state = { ...state, successfulFileCount: 2, skippedFileCount: 1 };

  const snapshot = createProgressSnapshot(state);

  assert.equal(snapshot.resolvedFileCount, 3);
  assert.equal(snapshot.activeFileCount, 2);
});

test("buildActiveFileSummary formats and orders active file paths", () => {
  const cases: Array<{
    name: string;
    files: Map<string, { claimOrder: number; lastProgressSeq: number }>;
    expected: string;
  }> = [
    {
      name: "empty map",
      files: new Map(),
      expected: ""
    },
    {
      name: "single entry",
      files: new Map([["src/a.ts", { claimOrder: 1, lastProgressSeq: 1 }]]),
      expected: "src/a.ts"
    },
    {
      name: "two entries ordered by recency",
      files: new Map([
        ["src/a.ts", { claimOrder: 1, lastProgressSeq: 1 }],
        ["src/b.ts", { claimOrder: 2, lastProgressSeq: 2 }]
      ]),
      expected: "src/b.ts, src/a.ts"
    },
    {
      name: "five entries capped at three with hidden count",
      files: new Map([
        ["src/a.ts", { claimOrder: 1, lastProgressSeq: 1 }],
        ["src/b.ts", { claimOrder: 2, lastProgressSeq: 2 }],
        ["src/c.ts", { claimOrder: 3, lastProgressSeq: 3 }],
        ["src/d.ts", { claimOrder: 4, lastProgressSeq: 4 }],
        ["src/e.ts", { claimOrder: 5, lastProgressSeq: 5 }]
      ]),
      expected: "src/e.ts, src/d.ts, src/c.ts | +2 more"
    },
    {
      name: "claim order tiebreaker",
      files: new Map([
        ["src/late-claim.ts", { claimOrder: 3, lastProgressSeq: 10 }],
        ["src/early-claim.ts", { claimOrder: 1, lastProgressSeq: 10 }]
      ]),
      expected: "src/early-claim.ts, src/late-claim.ts"
    }
  ];

  for (const { name, files, expected } of cases) {
    assert.equal(buildActiveFileSummary(files), expected, name);
  }
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

function makeEmptyState(): ProgressState {
  return {
    activeFiles: new Map(),
    eventSeq: 0,
    skippedFileCount: 0,
    successfulFileCount: 0
  };
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
