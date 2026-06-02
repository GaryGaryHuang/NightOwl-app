import assert from "node:assert/strict";
import test from "node:test";

import {
  createInitialProgressState,
  reduceProgressEvent
} from "../../src/cli/progress-state.ts";

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
