import assert from "node:assert/strict";
import test from "node:test";

import { createRunContext } from "../../src/core/run-context.ts";

test("createRunContext normalizes changesetOverview to exactly one trailing newline", () => {
  const cases = [
    {
      label: "append missing trailing newline",
      input: "## Changeset Overview\n- Modified `src/app.ts`",
      expected: "## Changeset Overview\n- Modified `src/app.ts`\n"
    },
    {
      label: "preserve existing trailing newline",
      input: "## Changeset Overview\n- Modified `src/app.ts`\n",
      expected: "## Changeset Overview\n- Modified `src/app.ts`\n"
    }
  ];

  for (const testCase of cases) {
    const ctx = createRunContext({
      changesetOverview: testCase.input,
      userContext: []
    });

    assert.equal(ctx.changesetOverview, testCase.expected, testCase.label);
    assert.equal(
      ctx.changesetOverview.endsWith("\n\n"),
      false,
      `${testCase.label}: must not double-append newline`
    );
  }
});

test("createRunContext preserves userContext values in an immutable snapshot", () => {
  const userContext = ["PR-123", "https://example.com/spec"];
  const ctx = createRunContext({
    changesetOverview: "overview\n",
    userContext
  });

  userContext.push("later mutation");

  assert.deepEqual([...ctx.userContext], ["PR-123", "https://example.com/spec"]);
  assert.ok(Object.isFrozen(ctx.userContext));
});

test("createRunContext freezes the returned RunContext", () => {
  const ctx = createRunContext({
    changesetOverview: "overview\n",
    userContext: []
  });

  assert.ok(Object.isFrozen(ctx));
});
