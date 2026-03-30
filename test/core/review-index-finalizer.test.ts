import assert from "node:assert/strict";
import test from "node:test";

import { ReviewIndexFinalizer } from "../../src/core/review-index-finalizer.ts";
import {
  createFinding,
  createOutputTarget,
  createPlannedNotes,
  createSkippedFile,
  createSuccessfulFile
} from "../helpers/completed-run-finalizer-contract-fixture.ts";

test("ReviewIndexFinalizer renders the exact review index contract with rebased risk labels", () => {
  const finalizer = new ReviewIndexFinalizer();

  const rendered = finalizer.render({
    repoRoot: "/workspace/repo",
    baseRef: "main",
    headRef: "feature-branch",
    outputTarget: createOutputTarget(),
    plannedNotes: createPlannedNotes([
      ["README.md", "/workspace/.nightowl/review/feature-branch_03131430/files/README.md.md"],
      ["src/app.ts", "/workspace/.nightowl/review/feature-branch_03131430/files/src__app.ts.md"],
      ["packages/app/index.ts", "/workspace/.nightowl/review/feature-branch_03131430/files/app__index.ts.md"]
    ]),
    successfulFiles: [createSuccessfulFile("README.md", [])],
    skippedFiles: [
      createSkippedFile(
        "src/app.ts",
        "step4-findings-interrogation",
        "deterministic validation failed"
      ),
      createSkippedFile(
        "packages/app/index.ts",
        "step4-findings-interrogation",
        "deterministic validation failed"
      )
    ]
  });

  assert.match(rendered, /^# Review Index$/mu);
  assert.match(rendered, /- Repo root: `\/workspace\/repo`/u);
  assert.match(rendered, /- Base ref: `main`/u);
  assert.match(rendered, /- Head ref: `feature-branch`/u);
  assert.match(rendered, /- Planned files: 3/u);
  assert.match(rendered, /- Successful files: 1/u);
  assert.match(rendered, /- Skipped files: 2/u);
  assert.match(
    rendered,
    /## Run Artifacts[\s\S]*- \[changeset-overview\.md\]\(\.\/changeset-overview\.md\)[\s\S]*- \[summary\.md\]\(\.\/summary\.md\)[\s\S]*- \[skipped\.md\]\(\.\/skipped\.md\)/u
  );
  assert.match(
    rendered,
    /## File Notes[\s\S]*- \[None\] \[`README\.md`\]\(\.\/files\/README\.md\.md\)[\s\S]*- \[Skipped\] \[`src\/app\.ts`\]\(\.\/files\/src__app\.ts\.md\)[\s\S]*- \[Skipped\] \[`packages\/app\/index\.ts`\]\(\.\/files\/app__index\.ts\.md\)/u
  );

  assertTextContainsInOrder(rendered, [
    "- Repo root: `/workspace/repo`",
    "- Base ref: `main`",
    "- Head ref: `feature-branch`",
    "- Planned files: 3",
    "- Successful files: 1",
    "- Skipped files: 2",
    "## Run Artifacts",
    "- [changeset-overview.md](./changeset-overview.md)",
    "- [summary.md](./summary.md)",
    "- [skipped.md](./skipped.md)",
    "## File Notes"
  ]);
});

test("ReviewIndexFinalizer renders explicit empty file notes for zero-file runs", () => {
  const finalizer = new ReviewIndexFinalizer();

  const rendered = finalizer.render({
    repoRoot: "/workspace/repo",
    baseRef: "main",
    headRef: "feature-branch",
    outputTarget: createOutputTarget(),
    plannedNotes: [],
    successfulFiles: [],
    skippedFiles: []
  });

  assert.match(rendered, /- Planned files: 0/u);
  assert.match(rendered, /- Successful files: 0/u);
  assert.match(rendered, /- Skipped files: 0/u);
  assert.match(
    rendered,
    /## Run Artifacts[\s\S]*- \[changeset-overview\.md\]\(\.\/changeset-overview\.md\)[\s\S]*- \[summary\.md\]\(\.\/summary\.md\)[\s\S]*- \[skipped\.md\]\(\.\/skipped\.md\)/u
  );
  assert.match(rendered, /## File Notes\n- 無/u);
});

test("ReviewIndexFinalizer preserves collision-resolved note targets and forward slashes", () => {
  const finalizer = new ReviewIndexFinalizer();

  const rendered = finalizer.render({
    repoRoot: String.raw`C:\workspace\repo`,
    baseRef: "main",
    headRef: "feature-branch",
    outputTarget: createOutputTarget({
      basePath: String.raw`C:\workspace\.nightowl\review\feature-branch_03131430`,
      changesetOverviewPath: String.raw`C:\workspace\.nightowl\review\feature-branch_03131430\changeset-overview.md`,
      filesPath: String.raw`C:\workspace\.nightowl\review\feature-branch_03131430\files`,
      skippedPath: String.raw`C:\workspace\.nightowl\review\feature-branch_03131430\skipped.md`,
      summaryPath: String.raw`C:\workspace\.nightowl\review\feature-branch_03131430\summary.md`,
      indexPath: String.raw`C:\workspace\.nightowl\review\feature-branch_03131430\index.md`,
      manifestPath: String.raw`C:\workspace\.nightowl\review\feature-branch_03131430\manifest.json`,
      toolAuditPath: String.raw`C:\workspace\.nightowl\review\feature-branch_03131430\tool-audit.jsonl`
    }),
    plannedNotes: createPlannedNotes([
      [
        "src/api/index.ts",
        String.raw`C:\workspace\.nightowl\review\feature-branch_03131430\files\src__api__index.ts.md`
      ],
      [
        "tests/api/index.ts",
        String.raw`C:\workspace\.nightowl\review\feature-branch_03131430\files\tests__api__index.ts.md`
      ]
    ]),
    successfulFiles: [
      createSuccessfulFile("src/api/index.ts", []),
      createSuccessfulFile("tests/api/index.ts", [])
    ],
    skippedFiles: []
  });

  assert.match(rendered, /- \[None\] \[`src\/api\/index\.ts`\]\(\.\/files\/src__api__index\.ts\.md\)/u);
  assert.match(
    rendered,
    /- \[None\] \[`tests\/api\/index\.ts`\]\(\.\/files\/tests__api__index\.ts\.md\)/u
  );
  assert.doesNotMatch(rendered, /\\files\\/u);
});

test("ReviewIndexFinalizer percent-encodes Markdown-unsafe note targets", () => {
  const finalizer = new ReviewIndexFinalizer();

  const rendered = finalizer.render({
    repoRoot: "/workspace/repo",
    baseRef: "main",
    headRef: "feature-branch",
    outputTarget: createOutputTarget(),
    plannedNotes: createPlannedNotes([
      ["foo bar.ts", "/workspace/.nightowl/review/feature-branch_03131430/files/foo bar.ts.md"],
      ["foo#bar).ts", "/workspace/.nightowl/review/feature-branch_03131430/files/foo#bar).ts.md"]
    ]),
    successfulFiles: [
      createSuccessfulFile("foo bar.ts", []),
      createSuccessfulFile("foo#bar).ts", [])
    ],
    skippedFiles: []
  });

  assert.match(rendered, /- \[None\] \[`foo bar\.ts`\]\(\.\/files\/foo%20bar\.ts\.md\)/u);
  assert.match(rendered, /- \[None\] \[`foo#bar\)\.ts`\]\(\.\/files\/foo%23bar%29\.ts\.md\)/u);
  assert.doesNotMatch(rendered, /\(\.\/files\/foo bar\.ts\.md\)/u);
  assert.doesNotMatch(rendered, /\(\.\/files\/foo#bar\)\.ts\.md\)/u);
});

test("ReviewIndexFinalizer sorts file notes by High to Medium to Low to None with skipped files last", () => {
  const finalizer = new ReviewIndexFinalizer();

  const rendered = finalizer.render({
    repoRoot: "/workspace/repo",
    baseRef: "main",
    headRef: "feature-branch",
    outputTarget: createOutputTarget(),
    plannedNotes: createPlannedNotes([
      ["none.ts", "/workspace/.nightowl/review/feature-branch_03131430/files/none.ts.md"],
      ["low.ts", "/workspace/.nightowl/review/feature-branch_03131430/files/low.ts.md"],
      ["medium.ts", "/workspace/.nightowl/review/feature-branch_03131430/files/medium.ts.md"],
      ["high.ts", "/workspace/.nightowl/review/feature-branch_03131430/files/high.ts.md"],
      ["skipped.ts", "/workspace/.nightowl/review/feature-branch_03131430/files/skipped.ts.md"]
    ]),
    successfulFiles: [
      createSuccessfulFile("none.ts", []),
      createSuccessfulFile("low.ts", [createFinding("nice", 80, { title: "Low issue" })]),
      createSuccessfulFile("medium.ts", [createFinding("must", 80, { title: "Medium issue" })]),
      createSuccessfulFile("high.ts", [createFinding("must", 90, { title: "High issue" })])
    ],
    skippedFiles: [
      createSkippedFile(
        "skipped.ts",
        "step4-findings-interrogation",
        "deterministic validation failed"
      )
    ]
  });

  const highIdx = rendered.indexOf("- [High] [`high.ts`]");
  const mediumIdx = rendered.indexOf("- [Medium] [`medium.ts`]");
  const lowIdx = rendered.indexOf("- [Low] [`low.ts`]");
  const noneIdx = rendered.indexOf("- [None] [`none.ts`]");
  const skippedIdx = rendered.indexOf("- [Skipped] [`skipped.ts`]");

  assert.ok(highIdx > 0, "high.ts should appear with [High] prefix");
  assert.ok(mediumIdx > 0, "medium.ts should appear with [Medium] prefix");
  assert.ok(lowIdx > 0, "low.ts should appear with [Low] prefix");
  assert.ok(noneIdx > 0, "none.ts should appear with [None] prefix");
  assert.ok(skippedIdx > 0, "skipped.ts should appear with [Skipped] prefix");
  assert.ok(highIdx < mediumIdx, "[High] file should come before [Medium] file");
  assert.ok(mediumIdx < lowIdx, "[Medium] file should come before [Low] file");
  assert.ok(lowIdx < noneIdx, "[Low] file should come before [None] file");
  assert.ok(noneIdx < skippedIdx, "[None] file should come before [Skipped] file");
});

test("ReviewIndexFinalizer preserves planned order within the same risk level", () => {
  const finalizer = new ReviewIndexFinalizer();

  const rendered = finalizer.render({
    repoRoot: "/workspace/repo",
    baseRef: "main",
    headRef: "feature-branch",
    outputTarget: createOutputTarget(),
    plannedNotes: createPlannedNotes([
      ["a.ts", "/workspace/.nightowl/review/feature-branch_03131430/files/a.ts.md"],
      ["b.ts", "/workspace/.nightowl/review/feature-branch_03131430/files/b.ts.md"],
      ["c.ts", "/workspace/.nightowl/review/feature-branch_03131430/files/c.ts.md"]
    ]),
    successfulFiles: [
      createSuccessfulFile("a.ts", []),
      createSuccessfulFile("b.ts", []),
      createSuccessfulFile("c.ts", [])
    ],
    skippedFiles: []
  });

  const aIdx = rendered.indexOf("- [None] [`a.ts`]");
  const bIdx = rendered.indexOf("- [None] [`b.ts`]");
  const cIdx = rendered.indexOf("- [None] [`c.ts`]");

  assert.ok(aIdx < bIdx && bIdx < cIdx, "same-risk files should preserve planned order a, b, c");
});

test("ReviewIndexFinalizer throws with identifying message when a planned file is absent from both outcome sets", () => {
  const finalizer = new ReviewIndexFinalizer();

  assert.throws(
    () =>
      finalizer.render({
        repoRoot: "/workspace/repo",
        baseRef: "main",
        headRef: "feature-branch",
        outputTarget: createOutputTarget(),
        plannedNotes: createPlannedNotes([
          [
            "src/missing.ts",
            "/workspace/.nightowl/review/feature-branch_03131430/files/src__missing.ts.md"
          ]
        ]),
        successfulFiles: [],
        skippedFiles: []
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(
        error.message,
        "Missing finalized outcome for planned file: src/missing.ts"
      );
      return true;
    }
  );
});

test("ReviewIndexFinalizer labels a file present in both outcome sets as its risk level (successfulFiles wins)", () => {
  const finalizer = new ReviewIndexFinalizer();

  const rendered = finalizer.render({
    repoRoot: "/workspace/repo",
    baseRef: "main",
    headRef: "feature-branch",
    outputTarget: createOutputTarget(),
    plannedNotes: createPlannedNotes([
      ["src/both.ts", "/workspace/.nightowl/review/feature-branch_03131430/files/src__both.ts.md"]
    ]),
    successfulFiles: [createSuccessfulFile("src/both.ts", [])],
    skippedFiles: [createSkippedFile("src/both.ts", "step1-overview", "judge rejected")]
  });

  assert.match(rendered, /- \[None\] \[`src\/both\.ts`\]/u);
  assert.doesNotMatch(rendered, /\[Skipped\]/u);
});

function assertTextContainsInOrder(text: string, fragments: string[]): void {
  let cursor = 0;

  for (const fragment of fragments) {
    const index = text.indexOf(fragment, cursor);

    assert.ok(index >= 0, `expected fragment in order: ${fragment}`);
    cursor = index + fragment.length;
  }
}
