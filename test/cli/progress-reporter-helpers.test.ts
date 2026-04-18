import assert from "node:assert/strict";
import test from "node:test";

import {
  buildActiveFileSummary,
  createProgressSnapshot,
  reduceProgressEvent,
  withActiveFileProgress,
  withResolvedOutcome
} from "../../src/cli/progress-reporter.ts";
import { createOutputTarget } from "../helpers/completed-run-finalizer-contract-fixture.ts";

const STEP1 = "step1-overview";

type ProgressState = Parameters<typeof reduceProgressEvent>[0];

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
      name: "file-completed removes active file and increments successful count",
      setupState() {
        return reduceProgressEvent(makeEmptyState(), {
          type: "file-claimed",
          filePath: "src/a.ts",
          claimOrder: 1
        }).state;
      },
      event: {
        type: "file-completed",
        filePath: "src/a.ts"
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
        reason: "judge rejected"
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
  const s4 = withResolvedOutcome(s3, "src/a.ts", "completed");

  assert.equal(s1.eventSeq, s0.eventSeq + 1);
  assert.equal(s2.eventSeq, s1.eventSeq + 1);
  assert.equal(s3.eventSeq, s2.eventSeq + 1);
  assert.equal(s3.activeFiles.get("src/a.ts")?.claimOrder, 99);
  assert.ok(
    (s3.activeFiles.get("src/a.ts")?.lastProgressSeq ?? 0) >
      (s1.activeFiles.get("src/a.ts")?.lastProgressSeq ?? 0)
  );
  assert.ok(!s4.activeFiles.has("src/a.ts"));
  assert.equal(s4.successfulFileCount, 1);
  assert.equal(s4.skippedFileCount, 0);
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

function makeEmptyState(): ProgressState {
  return {
    activeFiles: new Map(),
    eventSeq: 0,
    skippedFileCount: 0,
    successfulFileCount: 0
  };
}
