import assert from "node:assert/strict";
import test from "node:test";

import {
  STEP0_SYSTEM_MESSAGE,
  buildStep0Prompt
} from "../../../src/core/steps/step0-changeset-overview.ts";
import type { ReviewChangesetEntry } from "../../../src/providers/review-source-provider.ts";

function createChangesetEntries(
  ...entries: ReviewChangesetEntry[]
): ReviewChangesetEntry[] {
  return entries;
}

test("buildStep0Prompt always includes the <changed_files> block", () => {
  const prompt = buildStep0Prompt({
    changesetEntries: createChangesetEntries(
      { status: "M", path: "src/app.ts" },
      { status: "A", path: "src/new.ts" }
    ),
    userContext: []
  });

  assert.match(prompt, /<changed_files>/);
  assert.match(prompt, /M\tsrc\/app\.ts/);
  assert.match(prompt, /A\tsrc\/new\.ts/);
  assert.match(prompt, /<\/changed_files>/);
});

test("buildStep0Prompt omits the <user_context> delimiter block when userContext is empty", () => {
  const prompt = buildStep0Prompt({
    changesetEntries: createChangesetEntries({ status: "M", path: "src/app.ts" }),
    userContext: []
  });

  // Reference inside the instruction body is fine; what we forbid is emitting
  // the <user_context>...</user_context> delimiter block on its own lines.
  assert.equal(/^<user_context>$/m.test(prompt), false);
  assert.equal(/^<\/user_context>$/m.test(prompt), false);
});

test("buildStep0Prompt includes <user_context> block when entries are provided", () => {
  const prompt = buildStep0Prompt({
    changesetEntries: createChangesetEntries({ status: "M", path: "src/app.ts" }),
    userContext: ["PR-123", "https://example.com/spec"]
  });

  assert.match(prompt, /<user_context>/);
  assert.match(prompt, /PR-123/);
  assert.match(prompt, /https:\/\/example\.com\/spec/);
  assert.match(prompt, /<\/user_context>/);
});

test("buildStep0Prompt preserves rename similarity and previous path metadata", () => {
  const prompt = buildStep0Prompt({
    changesetEntries: createChangesetEntries({
      status: "R",
      similarityScore: 100,
      previousPath: "src/old.ts",
      path: "src/new.ts"
    }),
    userContext: []
  });

  assert.match(prompt, /R100\tsrc\/old\.ts\tsrc\/new\.ts/);
});

test("STEP0_SYSTEM_MESSAGE communicates the ChangeMap v1 JSON contract", () => {
  assert.match(STEP0_SYSTEM_MESSAGE, /Changeset Overview/);
  assert.match(STEP0_SYSTEM_MESSAGE, /schemaVersion/);
  assert.match(STEP0_SYSTEM_MESSAGE, /JSON-only/);
  assert.match(STEP0_SYSTEM_MESSAGE, /changedFiles/);
  assert.match(STEP0_SYSTEM_MESSAGE, /fileGroups/);
  assert.match(STEP0_SYSTEM_MESSAGE, /crossFileBoundaries/);
  assert.match(STEP0_SYSTEM_MESSAGE, /testCoverageObservations/);
  assert.match(STEP0_SYSTEM_MESSAGE, /behaviorChanges/);
  assert.match(STEP0_SYSTEM_MESSAGE, /evidenceRefs/);
  assert.match(STEP0_SYSTEM_MESSAGE, /unresolvedUnknowns/);
});

test("buildStep0Prompt instruction body includes the literal `## Changeset Overview` template header", () => {
  const prompt = buildStep0Prompt({
    changesetEntries: createChangesetEntries({ status: "M", path: "src/app.ts" }),
    userContext: []
  });

  assert.ok(
    prompt.includes("## Changeset Overview"),
    "Step 0 instruction must show the exact `## Changeset Overview` header so the model can emit the required overviewMarkdown prefix"
  );
  assert.ok(
    prompt.includes("\"schemaVersion\": 1"),
    "Step 0 instruction must include a minimal JSON example illustrating the ChangeMap shape"
  );
});
