import assert from "node:assert/strict";
import test from "node:test";

import {
  GENERIC_DRY_RUN_STUB,
  buildDryRunChangesetOverviewResponse,
  getDryRunResponseProvider,
  getDryRunStubResponse
} from "../../src/services/dry-run-stub-catalog.ts";

function buildPrompt(body: string): string {
  return ["<changed_files>", body, "</changed_files>"].join("\n");
}

function buildJsonPrompt(entries: unknown[]): string {
  return [
    '<changed_files_json format="json">',
    JSON.stringify({ entries }, null, 2),
    "</changed_files_json>",
    "",
    "<changed_files>",
    "M\tignored/raw.ts",
    "</changed_files>"
  ].join("\n");
}

test("buildDryRunChangesetOverviewResponse normalizes git rename/copy status (with or without similarity score) to R/A and uses head-side path", () => {
  const prompt = buildPrompt(
    [
      "R86\tsrc/old-name.ts\tsrc/new-name.ts",
      "C75\tsrc/original.ts\tsrc/copied.ts",
      "R\tsrc/bare-rename-old.ts\tsrc/bare-rename-new.ts",
      "C\tsrc/bare-copy-original.ts\tsrc/bare-copy-new.ts"
    ].join("\n")
  );

  const parsed = JSON.parse(buildDryRunChangesetOverviewResponse(prompt)) as {
    behaviorChanges: { files: string[] }[];
  };

  assert.deepEqual(
    parsed.behaviorChanges[0]?.files,
    ["src/new-name.ts", "src/copied.ts", "src/bare-rename-new.ts", "src/bare-copy-new.ts"]
  );
});

test("buildDryRunChangesetOverviewResponse prefers changed_files_json over raw changed_files", () => {
  const prompt = buildJsonPrompt([
    {
      originalStatus: "C",
      status: "A",
      path: "src/copied-from-json.ts",
      previousPath: "src/original.ts",
      copiedAsAdded: true
    },
    {
      originalStatus: "D",
      status: "D",
      path: "src/deleted-from-json.ts",
      deleted: true
    }
  ]);

  const parsed = JSON.parse(buildDryRunChangesetOverviewResponse(prompt)) as {
    behaviorChanges: { files: string[] }[];
  };

  assert.deepEqual(parsed.behaviorChanges[0]?.files, [
    "src/copied-from-json.ts",
    "src/deleted-from-json.ts"
  ]);
});

test("buildDryRunChangesetOverviewResponse falls back to M for unknown status tokens", () => {
  const prompt = buildPrompt(
    [
      "T\tsrc/type-change.ts",
      "U\tsrc/unmerged.ts",
      "X\tsrc/unknown.ts"
    ].join("\n")
  );

  const parsed = JSON.parse(buildDryRunChangesetOverviewResponse(prompt)) as {
    behaviorChanges: { files: string[] }[];
  };

  assert.deepEqual(parsed.behaviorChanges[0]?.files, [
    "src/type-change.ts",
    "src/unmerged.ts",
    "src/unknown.ts"
  ]);
});

test("buildDryRunChangesetOverviewResponse skips lines without a tab separator and skips entries with empty path", () => {
  const prompt = buildPrompt(
    [
      "M\tsrc/kept.ts",
      "no-tab-line",
      "M\t"
    ].join("\n")
  );

  const parsed = JSON.parse(buildDryRunChangesetOverviewResponse(prompt)) as {
    behaviorChanges: { files: string[] }[];
  };

  assert.deepEqual(parsed.behaviorChanges[0]?.files, ["src/kept.ts"]);
});

test("buildDryRunChangesetOverviewResponse emits a zero-file response when the prompt has no changed_files block", () => {
  const parsed = JSON.parse(
    buildDryRunChangesetOverviewResponse("(no block at all)")
  ) as {
    behaviorChanges: unknown[];
    userBehavior: unknown[];
  };

  assert.deepEqual(parsed.behaviorChanges, []);
  assert.deepEqual(parsed.userBehavior, []);
});

test("buildDryRunChangesetOverviewResponse emits a single behaviorChanges entry listing every changed path when at least one file is present", () => {
  const prompt = buildPrompt(["A\tsrc/a.ts", "M\tsrc/b.ts"].join("\n"));

  const parsed = JSON.parse(buildDryRunChangesetOverviewResponse(prompt)) as {
    behaviorChanges: { description: string; files: string[] }[];
  };

  assert.equal(parsed.behaviorChanges.length, 1);
  assert.equal(parsed.behaviorChanges[0].description, "Dry-run stub.");
  assert.deepEqual(parsed.behaviorChanges[0].files, ["src/a.ts", "src/b.ts"]);
});

test("getDryRunResponseProvider routes changeset-overview to the prompt-driven builder", () => {
  const provider = getDryRunResponseProvider("changeset-overview");
  const prompt = buildPrompt("M\tsrc/dispatched.ts");

  const parsed = JSON.parse(provider(prompt)) as {
    behaviorChanges: { files: string[] }[];
  };

  assert.deepEqual(parsed.behaviorChanges[0]?.files, ["src/dispatched.ts"]);
});

test("getDryRunResponseProvider returns a constant stub for known per-file step IDs and ignores prompt content", () => {
  const provider = getDryRunResponseProvider("review-summary");

  assert.equal(provider("anything"), getDryRunStubResponse("review-summary"));
  assert.equal(provider("anything else"), getDryRunStubResponse("review-summary"));
});

test("getDryRunResponseProvider falls back to GENERIC_DRY_RUN_STUB for unknown or missing step IDs", () => {
  assert.equal(getDryRunResponseProvider(undefined)("p"), GENERIC_DRY_RUN_STUB);
  assert.equal(getDryRunResponseProvider("not-a-step")("p"), GENERIC_DRY_RUN_STUB);
});
