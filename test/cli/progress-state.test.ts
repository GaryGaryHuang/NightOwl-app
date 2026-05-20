import assert from "node:assert/strict";
import test from "node:test";

import {
  buildActiveFileSummary,
  createInitialProgressState,
  reduceProgressEvent
} from "../../src/cli/progress-state.ts";

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

test("reduceProgressEvent warns on duplicate file claims for the same file", () => {
  const claimedState = reduceProgressEvent(createInitialProgressState(), {
    type: "file-claimed",
    filePath: "src/app.ts",
    claimOrder: 1
  }).state;
  const duplicateClaim = reduceProgressEvent(claimedState, {
    type: "file-claimed",
    filePath: "src/app.ts",
    claimOrder: 2
  });

  assert.equal(duplicateClaim.state, claimedState);
  assert.match(
    duplicateClaim.instruction.appendMessage ?? "",
    /warning: cliprogressreporter ignored duplicate claim/iu
  );
});

test("reduceProgressEvent warns when file progress arrives before claim", () => {
  const outOfOrderProgress = reduceProgressEvent(createInitialProgressState(), {
    type: "file-progressed",
    filePath: "src/app.ts",
    stepId: "review-basis"
  });

  assert.equal(outOfOrderProgress.state.activeFiles.size, 0);
  assert.match(
    outOfOrderProgress.instruction.appendMessage ?? "",
    /warning: cliprogressreporter ignored progress for non-active file/iu
  );
});

test("reduceProgressEvent warns when file completion arrives before claim", () => {
  const outOfOrderCompletion = reduceProgressEvent(createInitialProgressState(), {
    type: "file-completed",
    filePath: "src/app.ts"
  });

  assert.equal(outOfOrderCompletion.state.successfulFileCount, 0);
  assert.match(
    outOfOrderCompletion.instruction.appendMessage ?? "",
    /warning: cliprogressreporter ignored completed for non-active file/iu
  );
});

test("reduceProgressEvent renders transient run warnings", () => {
  const result = reduceProgressEvent(createInitialProgressState(), {
    type: "run-warning",
    message: "uncommitted changes are ignored"
  });

  assert.equal(
    result.instruction.appendMessage,
    "Warning: uncommitted changes are ignored"
  );
});
