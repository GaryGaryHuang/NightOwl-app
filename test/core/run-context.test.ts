import assert from "node:assert/strict";
import test from "node:test";

import type { ChangeMap } from "../../src/core/change-map.ts";
import { createRunContext } from "../../src/core/run-context.ts";

function makeChangeMap(overviewMarkdown: string): ChangeMap {
  return Object.freeze({
    schemaVersion: 1,
    overviewMarkdown,
    changedFiles: Object.freeze([]),
    fileGroups: Object.freeze([]),
    crossFileBoundaries: Object.freeze([]),
    testCoverageObservations: Object.freeze([]),
    behaviorChanges: Object.freeze([]),
    evidenceRefs: Object.freeze([]),
    unresolvedUnknowns: Object.freeze([])
  }) as ChangeMap;
}

test("createRunContext exposes the ChangeMap as changesetOverview by reference", () => {
  const changeMap = makeChangeMap("## Changeset Overview\n- x\n");
  const ctx = createRunContext({
    changesetOverview: changeMap,
    userContext: []
  });

  assert.equal(ctx.changesetOverview, changeMap);
  assert.equal(ctx.changesetOverview.schemaVersion, 1);
});

test("changesetOverviewMarkdown equals overviewMarkdown when it already ends with a newline", () => {
  const changeMap = makeChangeMap("## Changeset Overview\n- entry\n");
  const ctx = createRunContext({
    changesetOverview: changeMap,
    userContext: []
  });

  assert.equal(ctx.changesetOverviewMarkdown, "## Changeset Overview\n- entry\n");
  assert.equal(ctx.changesetOverviewMarkdown.endsWith("\n\n"), false);
});

test("changesetOverviewMarkdown appends a trailing newline without mutating the ChangeMap", () => {
  const overviewMarkdown = "## Changeset Overview\n- entry";
  const changeMap = makeChangeMap(overviewMarkdown);
  const ctx = createRunContext({
    changesetOverview: changeMap,
    userContext: []
  });

  assert.equal(ctx.changesetOverviewMarkdown, overviewMarkdown + "\n");
  assert.equal(
    ctx.changesetOverview.overviewMarkdown,
    overviewMarkdown,
    "createRunContext must not mutate the source ChangeMap.overviewMarkdown"
  );
});

test("createRunContext freezes the returned RunContext and snapshots userContext", () => {
  const userContext = ["PR-123", "https://example.com/spec"];
  const ctx = createRunContext({
    changesetOverview: makeChangeMap("## Changeset Overview\n- x\n"),
    userContext
  });

  userContext.push("later mutation");

  assert.deepEqual([...ctx.userContext], ["PR-123", "https://example.com/spec"]);
  assert.ok(Object.isFrozen(ctx));
  assert.ok(Object.isFrozen(ctx.userContext));
  assert.throws(() => {
    (ctx as unknown as { changesetOverviewMarkdown: string }).changesetOverviewMarkdown = "x";
  }, TypeError);
});
