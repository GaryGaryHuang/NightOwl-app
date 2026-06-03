import assert from "node:assert/strict";
import test from "node:test";

import {
  getDryRunResponseProvider
} from "../../src/services/dry-run-stub-catalog.ts";

function buildPrompt(body: string): string {
  return ["<changed_files>", body, "</changed_files>"].join("\n");
}

function buildChangesetOverviewResponse(prompt: string): string {
  return getDryRunResponseProvider("changeset-overview")(prompt);
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

test("changeset-overview dry-run response normalizes git rename/copy status and uses head-side path", () => {
  const prompt = buildPrompt(
    [
      "R86\tsrc/old-name.ts\tsrc/new-name.ts",
      "C75\tsrc/original.ts\tsrc/copied.ts",
      "R\tsrc/bare-rename-old.ts\tsrc/bare-rename-new.ts",
      "C\tsrc/bare-copy-original.ts\tsrc/bare-copy-new.ts"
    ].join("\n")
  );

  const parsed = JSON.parse(buildChangesetOverviewResponse(prompt)) as {
    behaviorChanges: { files: string[] }[];
  };

  assert.deepEqual(
    parsed.behaviorChanges[0]?.files,
    ["src/new-name.ts", "src/copied.ts", "src/bare-rename-new.ts", "src/bare-copy-new.ts"]
  );
});

test("changeset-overview dry-run response prefers changed_files_json over raw changed_files", () => {
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

  const parsed = JSON.parse(buildChangesetOverviewResponse(prompt)) as {
    behaviorChanges: { files: string[] }[];
  };

  assert.deepEqual(parsed.behaviorChanges[0]?.files, [
    "src/copied-from-json.ts",
    "src/deleted-from-json.ts"
  ]);
});

test("changeset-overview dry-run response falls back to M for unknown status tokens", () => {
  const prompt = buildPrompt(
    [
      "T\tsrc/type-change.ts",
      "U\tsrc/unmerged.ts",
      "X\tsrc/unknown.ts"
    ].join("\n")
  );

  const parsed = JSON.parse(buildChangesetOverviewResponse(prompt)) as {
    behaviorChanges: { files: string[] }[];
  };

  assert.deepEqual(parsed.behaviorChanges[0]?.files, [
    "src/type-change.ts",
    "src/unmerged.ts",
    "src/unknown.ts"
  ]);
});

test("changeset-overview dry-run response skips malformed lines and empty paths", () => {
  const prompt = buildPrompt(
    [
      "M\tsrc/kept.ts",
      "no-tab-line",
      "M\t"
    ].join("\n")
  );

  const parsed = JSON.parse(buildChangesetOverviewResponse(prompt)) as {
    behaviorChanges: { files: string[] }[];
  };

  assert.deepEqual(parsed.behaviorChanges[0]?.files, ["src/kept.ts"]);
});

test("changeset-overview dry-run response emits a zero-file response when the prompt has no changed_files block", () => {
  const parsed = JSON.parse(
    buildChangesetOverviewResponse("(no block at all)")
  ) as {
    behaviorChanges: unknown[];
    userBehavior: unknown[];
  };

  assert.deepEqual(parsed.behaviorChanges, []);
  assert.deepEqual(parsed.userBehavior, []);
});

test("changeset-overview dry-run response emits one behaviorChanges entry listing every changed path", () => {
  const prompt = buildPrompt(["A\tsrc/a.ts", "M\tsrc/b.ts"].join("\n"));

  const parsed = JSON.parse(buildChangesetOverviewResponse(prompt)) as {
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
  const response = provider("anything");

  assert.equal(provider("anything else"), response);
  assert.notEqual(response.length, 0);
});

test("getDryRunResponseProvider falls back consistently for unknown or missing step IDs", () => {
  const fallback = getDryRunResponseProvider(undefined)("p");

  assert.notEqual(fallback.length, 0);
  assert.equal(getDryRunResponseProvider("not-a-step")("p"), fallback);
});
