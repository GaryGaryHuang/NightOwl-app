import assert from "node:assert/strict";
import test from "node:test";

import type { ChangeMapReadinessV2 } from "../../src/core/change-map.ts";
import { createRunContext } from "../../src/core/run-context.ts";

function makeChangeMap(overviewMarkdown: string): ChangeMapReadinessV2 {
  return Object.freeze({
    reviewObjective: Object.freeze({
      summary: "Test review context.",
      requestedFocus: Object.freeze([]),
      expectedBehaviorSummary: Object.freeze([])
    }),
    userContext: Object.freeze([]),
    userBehavior: Object.freeze([]),
    missingInformation: Object.freeze([]),
    overviewMarkdown,
    behaviorChanges: Object.freeze([])
  }) as ChangeMapReadinessV2;
}

test("createRunContext exposes the ChangeMapReadinessV2 as changesetOverview by reference", () => {
  const changeMap = makeChangeMap("## Changeset Overview\n- x\n");
  const ctx = createRunContext({
    changesetOverview: changeMap,
    userContext: []
  });

  assert.equal(ctx.changesetOverview, changeMap);
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
    "createRunContext must not mutate the source ChangeMapReadinessV2.overviewMarkdown"
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
