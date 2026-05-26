import assert from "node:assert/strict";
import test from "node:test";

import { renderReviewIndex } from "../../../src/core/finalizers/review-index-finalizer.ts";
import type { PlannedNoteFile } from "../../../src/core/review-path-resolver.ts";
import type { SkippedFileOutcome, SuccessfulFileOutcome } from "../../../src/core/run-outcomes.ts";
import {
  createFinding,
  createOutputTarget,
  createPlannedNotes,
  createResolvedOutcomes,
  createSkippedFile,
  createSuccessfulFile
} from "../../helpers/completed-run-finalizer-contract-fixture.ts";

function renderIndex(input: {
  changesetOverviewMarkdown?: string;
  outputTarget?: ReturnType<typeof createOutputTarget>;
  plannedNotes: PlannedNoteFile[];
  successfulFiles: SuccessfulFileOutcome[];
  skippedFiles: SkippedFileOutcome[];
}): string {
  return renderReviewIndex({
    changesetOverviewMarkdown:
      input.changesetOverviewMarkdown ??
      [
        "## Changeset Overview",
        "- Scope: feature/config/test",
        "- Cross-file boundaries: none",
        "- Behavior changes: adds a review flow",
        "- Test coverage observations: no corresponding test changes observed"
      ].join("\n"),
    outputTarget: input.outputTarget ?? createOutputTarget(),
    plannedNotes: input.plannedNotes,
    resolvedOutcomes: createResolvedOutcomes(input.plannedNotes, input.successfulFiles, input.skippedFiles)
  });
}

test("ReviewIndexFinalizer renders review overview, change context, and grouped file sections", () => {
  const rendered = renderIndex({
    plannedNotes: createPlannedNotes([
      plannedNote("README.md", "README.md.md"),
      plannedNote("src/app.ts", "src__app.ts.md"),
      plannedNote("packages/app/index.ts", "app__index.ts.md")
    ]),
    successfulFiles: [createSuccessfulFile("README.md", [])],
    skippedFiles: [
      createSkippedFile(
        "src/app.ts",
        "candidate-findings",
        "deterministic validation failed"
      ),
      createSkippedFile(
        "packages/app/index.ts",
        "candidate-findings",
        "deterministic validation failed"
      )
    ]
  });

  assert.match(rendered, /^# Review Index$/mu);
  assert.match(rendered, /## Review Overview/u);
  assert.match(rendered, /- Findings: must=0, nice=0/u);
  assert.match(rendered, /- Review coverage: 1\/3 files fully reviewed/u);
  assert.doesNotMatch(rendered, /- Review limitations:/u);
  assert.match(rendered, /## Skipped Files/u);
  assert.match(rendered, /## Change Context/u);
  assert.match(rendered, /## Clean Files/u);
  assert.doesNotMatch(rendered, /## Files Requiring Attention/u);
  assert.doesNotMatch(rendered, /## File Notes/u);
  assertTextContainsInOrder(rendered, [
    "## Review Overview",
    "- Findings: must=0, nice=0",
    "- Review coverage: 1/3 files fully reviewed",
    "## Skipped Files",
    "- [`src/app.ts`](./files/src__app.ts.md)",
    "- [`packages/app/index.ts`](./files/app__index.ts.md)",
    "## Change Context",
    "- Scope: feature/config/test",
    "- Behavior changes: adds a review flow",
    "## Clean Files",
    "- [`README.md`](./files/README.md.md)"
  ]);
});

test("ReviewIndexFinalizer renders an explicit empty clean-files section for zero-file runs", () => {
  const rendered = renderIndex({
    plannedNotes: [],
    successfulFiles: [],
    skippedFiles: []
  });

  assert.match(rendered, /- Review coverage: 0\/0 files fully reviewed/u);
  assert.doesNotMatch(rendered, /- Review limitations:/u);
  assert.doesNotMatch(rendered, /## Skipped Files/u);
  assert.doesNotMatch(rendered, /## Files Requiring Attention/u);
  assert.match(rendered, /## Clean Files\n- 無/u);
});

test("ReviewIndexFinalizer preserves collision-resolved note targets and forward slashes", () => {
  const rendered = renderIndex({
    outputTarget: createOutputTarget({
      basePath: String.raw`C:\workspace\.nightowl\review\feature-branch_03131430`,
      changesetOverviewPath: String.raw`C:\workspace\.nightowl\review\feature-branch_03131430\changeset-overview.md`,
      filesPath: String.raw`C:\workspace\.nightowl\review\feature-branch_03131430\files`,
      indexPath: String.raw`C:\workspace\.nightowl\review\feature-branch_03131430\index.md`,
      toolAuditPath: String.raw`C:\workspace\.nightowl\review\feature-branch_03131430\tool-audit.jsonl`
    }),
    plannedNotes: createPlannedNotes([
      windowsPlannedNote("src/api/index.ts", "src__api__index.ts.md"),
      windowsPlannedNote("tests/api/index.ts", "tests__api__index.ts.md")
    ]),
    successfulFiles: [
      createSuccessfulFile("src/api/index.ts", []),
      createSuccessfulFile("tests/api/index.ts", [])
    ],
    skippedFiles: []
  });

  assert.match(rendered, /- \[`src\/api\/index\.ts`\]\(\.\/files\/src__api__index\.ts\.md\)/u);
  assert.match(
    rendered,
    /- \[`tests\/api\/index\.ts`\]\(\.\/files\/tests__api__index\.ts\.md\)/u
  );
  assert.doesNotMatch(rendered, /\\files\\/u);
});

test("ReviewIndexFinalizer percent-encodes Markdown-unsafe note targets", () => {
  const rendered = renderIndex({
    outputTarget: createOutputTarget(),
    plannedNotes: createPlannedNotes([
      plannedNote("foo bar.ts", "foo bar.ts.md"),
      plannedNote("foo#bar).ts", "foo#bar).ts.md")
    ]),
    successfulFiles: [
      createSuccessfulFile("foo bar.ts", []),
      createSuccessfulFile("foo#bar).ts", [])
    ],
    skippedFiles: []
  });

  assert.match(rendered, /- \[`foo bar\.ts`\]\(\.\/files\/foo%20bar\.ts\.md\)/u);
  assert.match(rendered, /- \[`foo#bar\)\.ts`\]\(\.\/files\/foo%23bar%29\.ts\.md\)/u);
  assert.doesNotMatch(rendered, /\(\.\/files\/foo bar\.ts\.md\)/u);
  assert.doesNotMatch(rendered, /\(\.\/files\/foo#bar\)\.ts\.md\)/u);
});

test("ReviewIndexFinalizer splits successful files into attention and clean sections", () => {
  const rendered = renderIndex({
    outputTarget: createOutputTarget(),
    plannedNotes: createPlannedNotes([
      plannedNote("nice.ts"),
      plannedNote("clean.ts"),
      plannedNote("missing.ts"),
      plannedNote("must.ts"),
      plannedNote("skipped.ts")
    ]),
    successfulFiles: [
      createSuccessfulFile("nice.ts", [createFinding("nice", 80, { title: "Low issue" })]),
      createSuccessfulFile("clean.ts", []),
      createSuccessfulFile("missing.ts", [], {
        status: "passed_with_limitations",
        missingInformationCount: 2
      }),
      createSuccessfulFile("must.ts", [createFinding("must", 90, { title: "High issue" })])
    ],
    skippedFiles: [
      createSkippedFile(
        "skipped.ts",
        "candidate-findings",
        "deterministic validation failed"
      )
    ]
  });

  assertTextContainsInOrder(rendered, [
    "## Skipped Files",
    "- [`skipped.ts`](./files/skipped.ts.md)",
    "## Files Requiring Attention",
    "| [must.ts](./files/must.ts.md) | 1 | 0 | 0 |",
    "| [missing.ts](./files/missing.ts.md) | 0 | 0 | 2 |",
    "| [nice.ts](./files/nice.ts.md) | 0 | 1 | 0 |",
    "## Clean Files",
    "- [`clean.ts`](./files/clean.ts.md)"
  ]);
});

test("ReviewIndexFinalizer preserves planned order within the clean-files section", () => {
  const rendered = renderIndex({
    outputTarget: createOutputTarget(),
    plannedNotes: createPlannedNotes([
      plannedNote("a.ts"),
      plannedNote("b.ts"),
      plannedNote("c.ts")
    ]),
    successfulFiles: [
      createSuccessfulFile("a.ts", []),
      createSuccessfulFile("b.ts", []),
      createSuccessfulFile("c.ts", [])
    ],
    skippedFiles: []
  });

  assertTextContainsInOrder(rendered, [
    "## Clean Files",
    "- [`a.ts`](./files/a.ts.md)",
    "- [`b.ts`](./files/b.ts.md)",
    "- [`c.ts`](./files/c.ts.md)"
  ]);
});

test("ReviewIndexFinalizer separates missing-information files from clean files", () => {
  const rendered = renderIndex({
    outputTarget: createOutputTarget(),
    plannedNotes: createPlannedNotes([
      plannedNote("src/clean.ts"),
      plannedNote("src/blocked.ts")
    ]),
    successfulFiles: [
      createSuccessfulFile("src/clean.ts", [], {
        status: "passed",
        semanticIterationCount: 1,
        candidateFindingCount: 0,
        approvedFindingCount: 0,
        missingInformationCount: 0,
        decisionCounts: {}
      }),
      createSuccessfulFile("src/blocked.ts", [], {
        status: "passed_with_limitations",
        loopAction: "accept",
        semanticIterationCount: 1,
        candidateFindingCount: 1,
        approvedFindingCount: 0,
        missingInformationCount: 1,
        decisionCounts: { drop: 1 }
      })
    ],
    skippedFiles: []
  });

  assert.match(
    rendered,
    /\| \[src\/blocked\.ts\]\(\.\/files\/src\/blocked\.ts\.md\) \| 0 \| 0 \| 1 \|/u
  );
  assert.match(
    rendered,
    /## Clean Files[\s\S]*- \[`src\/clean\.ts`\]\(\.\/files\/src\/clean\.ts\.md\)/u
  );
  assert.match(rendered, /- Review limitations: 1 file has missing information/u);
});

test("ReviewIndexFinalizer projects scope and behavior changes from the changeset overview", () => {
  const rendered = renderIndex({
    changesetOverviewMarkdown: [
      "## Changeset Overview",
      "- Scope: bugfix/test",
      "- Cross-file boundaries: none",
      "- Behavior changes: fixes retry backoff behavior",
      "- Test coverage observations: retry tests updated"
    ].join("\n"),
    plannedNotes: createPlannedNotes([plannedNote("src/retry.ts")]),
    successfulFiles: [createSuccessfulFile("src/retry.ts", [])],
    skippedFiles: []
  });

  assert.match(rendered, /- Scope: bugfix\/test/u);
  assert.match(rendered, /- Behavior changes: fixes retry backoff behavior/u);
});

test("ReviewIndexFinalizer escapes table-breaking pipe characters in attention rows", () => {
  const rendered = renderIndex({
    plannedNotes: createPlannedNotes([
      plannedNote("src/foo|bar.ts", "src__foo|bar.ts.md")
    ]),
    successfulFiles: [
      createSuccessfulFile("src/foo|bar.ts", [
        createFinding("nice", 80, { title: "Low issue" })
      ])
    ],
    skippedFiles: []
  });

  assert.match(
    rendered,
    /\| \[src\/foo\\\|bar\.ts\]\(\.\/files\/src__foo%7Cbar\.ts\.md\) \| 0 \| 1 \| 0 \|/u
  );
});

function assertTextContainsInOrder(text: string, fragments: string[]): void {
  let cursor = 0;

  for (const fragment of fragments) {
    const index = text.indexOf(fragment, cursor);

    assert.ok(index >= 0, `expected fragment in order: ${fragment}`);
    cursor = index + fragment.length;
  }
}

function plannedNote(
  filePath: string,
  noteName = `${filePath}.md`
): [filePath: string, noteFilePath: string] {
  return [
    filePath,
    `/workspace/.nightowl/review/feature-branch_03131430/files/${noteName}`
  ];
}

function windowsPlannedNote(
  filePath: string,
  noteName: string
): [filePath: string, noteFilePath: string] {
  return [
    filePath,
    `C:\\workspace\\.nightowl\\review\\feature-branch_03131430\\files\\${noteName}`
  ];
}
