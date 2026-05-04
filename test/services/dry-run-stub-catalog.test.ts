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
    changedFiles: { path: string; status: string }[];
  };

  assert.deepEqual(
    parsed.changedFiles.map(({ path, status }) => ({ path, status })),
    [
      { path: "src/new-name.ts", status: "R" },
      { path: "src/copied.ts", status: "A" },
      { path: "src/bare-rename-new.ts", status: "R" },
      { path: "src/bare-copy-new.ts", status: "A" }
    ]
  );
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
    changedFiles: { path: string; status: string }[];
  };

  assert.deepEqual(
    parsed.changedFiles.map(({ status }) => status),
    ["M", "M", "M"]
  );
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
    changedFiles: { path: string }[];
  };

  assert.deepEqual(parsed.changedFiles.map(({ path }) => path), ["src/kept.ts"]);
});

test("buildDryRunChangesetOverviewResponse emits a zero-file ChangeMapReadinessV2 when the prompt has no changed_files block", () => {
  const parsed = JSON.parse(
    buildDryRunChangesetOverviewResponse("(no block at all)")
  ) as {
    schemaVersion: number;
    changeScope: { totalChangedPaths: number };
    changedFiles: unknown[];
    fileGroups: unknown[];
  };

  assert.equal(parsed.schemaVersion, 2);
  assert.equal(parsed.changeScope.totalChangedPaths, 0);
  assert.deepEqual(parsed.changedFiles, []);
  assert.deepEqual(parsed.fileGroups, []);
});

test("buildDryRunChangesetOverviewResponse preserves user context order in userContextSSOT", () => {
  const prompt = [
    "<changed_files>",
    "M\tsrc/app.ts",
    "</changed_files>",
    "",
    '<user_context format="json">',
    JSON.stringify({ entries: ["first", "second"] }, null, 2),
    "</user_context>"
  ].join("\n");

  const parsed = JSON.parse(buildDryRunChangesetOverviewResponse(prompt)) as {
    userContextSSOT: { contextId: string; rawText: string }[];
  };

  assert.deepEqual(
    parsed.userContextSSOT.map(({ contextId, rawText }) => ({ contextId, rawText })),
    [
    { contextId: "UC1", rawText: "first" },
    { contextId: "UC2", rawText: "second" }
    ]
  );
});

test("buildDryRunChangesetOverviewResponse emits a single dry-run fileGroup listing every changed path when at least one file is present", () => {
  const prompt = buildPrompt(["A\tsrc/a.ts", "M\tsrc/b.ts"].join("\n"));

  const parsed = JSON.parse(buildDryRunChangesetOverviewResponse(prompt)) as {
    fileGroups: { id: string; label: string; files: string[] }[];
  };

  assert.equal(parsed.fileGroups.length, 1);
  assert.equal(parsed.fileGroups[0].id, "G1");
  assert.equal(parsed.fileGroups[0].label, "dry-run");
  assert.deepEqual(parsed.fileGroups[0].files, ["src/a.ts", "src/b.ts"]);
});

test("getDryRunResponseProvider routes changeset-overview to the prompt-driven builder", () => {
  const provider = getDryRunResponseProvider("changeset-overview");
  const prompt = buildPrompt("M\tsrc/dispatched.ts");

  const parsed = JSON.parse(provider(prompt)) as {
    changedFiles: { path: string }[];
  };

  assert.deepEqual(parsed.changedFiles.map(({ path }) => path), ["src/dispatched.ts"]);
});

test("getDryRunResponseProvider returns a constant stub for known per-file step IDs and ignores prompt content", () => {
  const provider = getDryRunResponseProvider("step1-overview");

  assert.equal(provider("anything"), getDryRunStubResponse("step1-overview"));
  assert.equal(provider("anything else"), getDryRunStubResponse("step1-overview"));
});

test("getDryRunResponseProvider falls back to GENERIC_DRY_RUN_STUB for unknown or missing step IDs", () => {
  assert.equal(getDryRunResponseProvider(undefined)("p"), GENERIC_DRY_RUN_STUB);
  assert.equal(getDryRunResponseProvider("not-a-step")("p"), GENERIC_DRY_RUN_STUB);
});
