import assert from "node:assert/strict";
import test from "node:test";

import {
  renderCleanFilesSection,
  renderFilesRequiringAttentionSection,
  renderSkippedFilesSection
} from "../../../src/core/finalizers/run-summary-section.ts";
import {
  createFinding,
  createOutputTarget,
  createPlannedNotesFromPaths,
  createResolvedOutcomes,
  createSkippedFile,
  createSuccessfulFile
} from "../../helpers/completed-run-finalizer-contract-fixture.ts";

const OUTPUT_TARGET = createOutputTarget();

function renderSummarySection(overrides: {
  plannedNotes?: ReturnType<typeof createPlannedNotesFromPaths>;
  successfulFiles?: ReturnType<typeof createSuccessfulFile>[];
  skippedFiles?: ReturnType<typeof createSkippedFile>[];
} = {}): string | undefined {
  const plannedNotes = overrides.plannedNotes ?? [];
  const successfulFiles = overrides.successfulFiles ?? [];
  const skippedFiles = overrides.skippedFiles ?? [];

  return renderFilesRequiringAttentionSection({
    basePath: OUTPUT_TARGET.basePath,
    plannedNotes,
    resolvedOutcomes: createResolvedOutcomes(plannedNotes, successfulFiles, skippedFiles)
  });
}

function renderSkippedSection(overrides: {
  plannedNotes?: ReturnType<typeof createPlannedNotesFromPaths>;
  successfulFiles?: ReturnType<typeof createSuccessfulFile>[];
  skippedFiles?: ReturnType<typeof createSkippedFile>[];
} = {}): string | undefined {
  const plannedNotes = overrides.plannedNotes ?? [];
  const successfulFiles = overrides.successfulFiles ?? [];
  const skippedFiles = overrides.skippedFiles ?? [];

  return renderSkippedFilesSection({
    basePath: OUTPUT_TARGET.basePath,
    plannedNotes,
    resolvedOutcomes: createResolvedOutcomes(plannedNotes, successfulFiles, skippedFiles)
  });
}

function renderCleanSection(overrides: {
  plannedNotes?: ReturnType<typeof createPlannedNotesFromPaths>;
  successfulFiles?: ReturnType<typeof createSuccessfulFile>[];
  skippedFiles?: ReturnType<typeof createSkippedFile>[];
} = {}): string | undefined {
  const plannedNotes = overrides.plannedNotes ?? [];
  const successfulFiles = overrides.successfulFiles ?? [];
  const skippedFiles = overrides.skippedFiles ?? [];

  return renderCleanFilesSection({
    basePath: OUTPUT_TARGET.basePath,
    plannedNotes,
    resolvedOutcomes: createResolvedOutcomes(plannedNotes, successfulFiles, skippedFiles)
  });
}

test("RunSummarySection renders an attention table with linked file rows", () => {
  const rendered = renderSummarySection({
    plannedNotes: createPlannedNotesFromPaths(["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"]),
    successfulFiles: [
      createSuccessfulFile("src/a.ts", [
        createFinding("must", 92, { title: "Must finding" }),
        createFinding("nice", 95, { title: "Nice finding" })
      ]),
      createSuccessfulFile("src/b.ts", [], {
        status: "passed_with_limitations",
        missingInformationCount: 2
      }),
      createSuccessfulFile("src/c.ts", [
        createFinding("nice", 89, { title: "Another nice" })
      ]),
      createSuccessfulFile("src/d.ts", [])
    ]
  });

  assert.match(rendered ?? "", /^## Files Requiring Attention$/mu);
  assert.match(rendered ?? "", /\| File \| Must \| Nice \| Missing Info \|/u);
  assertTextContainsInOrder(rendered ?? "", [
    "## Files Requiring Attention",
    "| [src/a.ts](./files/src__a.ts.md) | 1 | 1 | 0 |",
    "| [src/b.ts](./files/src__b.ts.md) | 0 | 0 | 2 |",
    "| [src/c.ts](./files/src__c.ts.md) | 0 | 1 | 0 |"
  ]);

  const cleanRendered = renderCleanSection({
    plannedNotes: createPlannedNotesFromPaths(["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"]),
    successfulFiles: [
      createSuccessfulFile("src/a.ts", [
        createFinding("must", 92, { title: "Must finding" }),
        createFinding("nice", 95, { title: "Nice finding" })
      ]),
      createSuccessfulFile("src/b.ts", [], {
        status: "passed_with_limitations",
        missingInformationCount: 2
      }),
      createSuccessfulFile("src/c.ts", [
        createFinding("nice", 89, { title: "Another nice" })
      ])
      ,
      createSuccessfulFile("src/d.ts", [])
    ]
  });

  assert.match(cleanRendered ?? "", /^## Clean Files$/mu);
  assertTextContainsInOrder(cleanRendered ?? "", [
    "## Clean Files",
    "- [`src/d.ts`](./files/src__d.ts.md)"
  ]);
});

test("RunSummarySection renders skipped files as a plain link list without reasons", () => {
  const rendered = renderSkippedSection({
    plannedNotes: createPlannedNotesFromPaths(["src/a.ts", "src/b.ts"]),
    successfulFiles: [createSuccessfulFile("src/a.ts", [])],
    skippedFiles: [createSkippedFile(
      "src/b.ts",
      "candidate-findings",
      "deterministic validation failed"
    )]
  });

  assert.match(rendered ?? "", /^## Skipped Files$/mu);
  assert.match(rendered ?? "", /- \[`src\/b\.ts`\]\(\.\/files\/src__b\.ts\.md\)/u);
  assert.doesNotMatch(rendered ?? "", /candidate-findings/u);
  assert.doesNotMatch(rendered ?? "", /deterministic validation failed/u);
});

test("RunSummarySection omits empty attention, clean, and skipped sections", () => {
  const rendered = renderSummarySection();

  assert.equal(rendered, undefined);
  assert.equal(renderCleanSection(), undefined);
  assert.equal(renderSkippedSection(), undefined);
});

test("RunSummarySection keeps clean files as plain links without counters or badges", () => {
  const rendered = renderCleanSection({
    plannedNotes: createPlannedNotesFromPaths(["src/clean.ts", "src/also-clean.ts"]),
    successfulFiles: [
      createSuccessfulFile("src/clean.ts", []),
      createSuccessfulFile("src/also-clean.ts", [])
    ]
  });

  assertTextContainsInOrder(rendered ?? "", [
    "## Clean Files",
    "- [`src/clean.ts`](./files/src__clean.ts.md)",
    "- [`src/also-clean.ts`](./files/src__also-clean.ts.md)"
  ]);
  assert.doesNotMatch(rendered ?? "", /must=/u);
  assert.doesNotMatch(rendered ?? "", /nice=/u);
  assert.doesNotMatch(rendered ?? "", /\[Passed\]/u);
});

test("RunSummarySection omits the attention section when all successful files are clean", () => {
  const rendered = renderSummarySection({
    plannedNotes: createPlannedNotesFromPaths(["src/a.ts", "src/b.ts"]),
    successfulFiles: [
      createSuccessfulFile("src/a.ts", []),
      createSuccessfulFile("src/b.ts", [])
    ]
  });

  assert.equal(rendered, undefined);
});

test("RunSummarySection orders attention files by must then missing information then nice", () => {
  const rendered = renderSummarySection({
    plannedNotes: createPlannedNotesFromPaths(["nice.ts", "clean.ts", "missing.ts", "must.ts"]),
    successfulFiles: [
      createSuccessfulFile("nice.ts", [createFinding("nice", 88, { title: "Low issue" })]),
      createSuccessfulFile("clean.ts", []),
      createSuccessfulFile("missing.ts", [], {
        status: "passed_with_limitations",
        missingInformationCount: 1
      }),
      createSuccessfulFile("must.ts", [createFinding("must", 90, { title: "High issue" })])
    ]
  });

  assertTextContainsInOrder(rendered ?? "", [
    "| [must.ts](./files/must.ts.md) | 1 | 0 | 0 |",
    "| [missing.ts](./files/missing.ts.md) | 0 | 0 | 1 |",
    "| [nice.ts](./files/nice.ts.md) | 0 | 1 | 0 |"
  ]);
});

test("RunSummarySection escapes table-breaking pipe characters in attention file labels", () => {
  const rendered = renderSummarySection({
    plannedNotes: createPlannedNotesFromPaths(["src/foo|bar.ts"]),
    successfulFiles: [
      createSuccessfulFile("src/foo|bar.ts", [
        createFinding("nice", 88, { title: "Low issue" })
      ])
    ]
  });

  assert.match(
    rendered ?? "",
    /\| \[src\/foo\\\|bar\.ts\]\(\.\/files\/src__foo%7Cbar\.ts\.md\) \| 0 \| 1 \| 0 \|/u
  );
  assert.doesNotMatch(
    rendered ?? "",
    /\| \[src\/foo\|bar\.ts\]\(\.\/files\/src__foo%7Cbar\.ts\.md\) \| 0 \| 1 \| 0 \|/u
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
