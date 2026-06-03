import assert from "node:assert/strict";
import test from "node:test";

import type { ChangeMapReadiness } from "../../src/core/change-map.ts";
import { createRunContext } from "../../src/core/run-context.ts";

function makeChangeMap(overviewMarkdown: string): ChangeMapReadiness {
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
  }) as ChangeMapReadiness;
}

test("createRunContext exposes the ChangeMapReadiness as changesetOverview by reference", () => {
  const changeMap = makeChangeMap("## Changeset Overview\n- x\n");
  const ctx = createRunContext({
    changesetOverview: changeMap
  });

  assert.equal(ctx.changesetOverview, changeMap);
});

test("changesetOverviewMarkdown equals overviewMarkdown when it already ends with a newline", () => {
  const changeMap = makeChangeMap("## Changeset Overview\n- entry\n");
  const ctx = createRunContext({
    changesetOverview: changeMap
  });

  assert.equal(ctx.changesetOverviewMarkdown, "## Changeset Overview\n- entry\n");
  assert.equal(ctx.changesetOverviewMarkdown.endsWith("\n\n"), false);
});

test("changesetOverviewMarkdown appends a trailing newline without mutating the ChangeMap", () => {
  const overviewMarkdown = "## Changeset Overview\n- entry";
  const changeMap = makeChangeMap(overviewMarkdown);
  const ctx = createRunContext({
    changesetOverview: changeMap
  });

  assert.equal(ctx.changesetOverviewMarkdown, overviewMarkdown + "\n");
  assert.equal(
    ctx.changesetOverview.overviewMarkdown,
    overviewMarkdown,
    "createRunContext must not mutate the source ChangeMapReadiness.overviewMarkdown"
  );
});

test("createRunContext freezes the returned RunContext", () => {
  const ctx = createRunContext({
    changesetOverview: makeChangeMap("## Changeset Overview\n- x\n")
  });

  assert.ok(Object.isFrozen(ctx));
  assert.throws(() => {
    (ctx as unknown as { changesetOverviewMarkdown: string }).changesetOverviewMarkdown = "x";
  }, TypeError);
});
