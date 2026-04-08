import assert from "node:assert/strict";
import test from "node:test";

import { createRunContext } from "../../src/core/run-context.ts";

test("createRunContext appends trailing newline when changesetOverview does not end with one", () => {
  const ctx = createRunContext({
    changesetOverview: "## Changeset Overview\n- Modified `src/app.ts`",
    userContext: []
  });

  assert.equal(ctx.changesetOverview, "## Changeset Overview\n- Modified `src/app.ts`\n");
});

test("createRunContext preserves changesetOverview unchanged when it already ends with a trailing newline", () => {
  const overview = "## Changeset Overview\n- Modified `src/app.ts`\n";
  const ctx = createRunContext({
    changesetOverview: overview,
    userContext: []
  });

  assert.equal(ctx.changesetOverview, overview);
});

test("createRunContext does not append more than one trailing newline when content already ends with one", () => {
  const overview = "## Changeset Overview\n- Modified `src/app.ts`\n";
  const ctx = createRunContext({
    changesetOverview: overview,
    userContext: []
  });

  assert.ok(!ctx.changesetOverview.endsWith("\n\n"), "must not double-append \\n");
});

test("createRunContext preserves userContext values as-is", () => {
  const ctx = createRunContext({
    changesetOverview: "overview\n",
    userContext: ["PR-123", "https://example.com/spec"]
  });

  assert.deepEqual([...ctx.userContext], ["PR-123", "https://example.com/spec"]);
});

test("createRunContext freezes the returned RunContext", () => {
  const ctx = createRunContext({
    changesetOverview: "overview\n",
    userContext: []
  });

  assert.ok(Object.isFrozen(ctx));
});
