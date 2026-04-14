import assert from "node:assert/strict";
import test from "node:test";

import {
  FileReviewContext,
  type FileReviewContextInput,
  type Finding
} from "../../src/core/file-review-context.ts";
import { ReviewNoteFinalizer } from "../../src/core/finalizer.ts";
import {
  assertBootstrapShape,
  assertFindingsStats,
  assertFindingsTitlesInOrder,
  assertTextContainsInOrder,
  assertTextExcludesAll,
  assertTraceabilityForms,
  assertWarningBlock,
  assertWarningBlockAtEnd
} from "../helpers/finalizer-contract-fixture.ts";

const FILE_PATH = "src/app.ts";

const DEFAULT_INPUT: FileReviewContextInput = {
  filePath: FILE_PATH,
  noteFilePath: "/workspace/.nightowl/review/run/files/src__app.ts.md",
  diffContent: "@@ -1 +1 @@\n-old\n+new\n",
  baseRef: "main",
  headRef: "feature-branch"
};

function createContext(): FileReviewContext {
  return new FileReviewContext(DEFAULT_INPUT);
}

function makeMustFinding(title: string): Finding {
  return {
    type: "must",
    title,
    traceability: { kind: "line-range", lineStart: 1, lineEnd: 1 },
    context: "test-context",
    deviation: "test-deviation",
    impact: "test-impact",
    suggestion: "test-suggestion",
    confidence: 0.9
  };
}

function makeNiceFinding(title: string): Finding {
  return {
    type: "nice",
    title,
    traceability: { kind: "diff-hunk", hunkHeader: "@@ -1,3 +1,3 @@" },
    context: "test-context",
    deviation: "test-deviation",
    impact: "test-impact",
    suggestion: "test-suggestion",
    confidence: 0.8
  };
}

const finalizer = new ReviewNoteFinalizer();

// 5.2: sections render in insertion order
test("Finalizer renders sections in insertion order", () => {
  const context = createContext();

  context.setSection("overview", "## Overview\nOverview content");
  context.setSection("strategy", "## Strategy\nStrategy content");
  context.setSection("custom-analysis", "## Custom Analysis\nCustom content");
  context.setSection("summary", "## Summary\nSummary content");

  const result = finalizer.render(context);

  assertTextContainsInOrder(result, [
    "## Overview",
    "## Strategy",
    "## Custom Analysis",
    "## Summary"
  ]);
});

// 5.3: custom section relative to findings anchor
test("Finalizer renders custom section before findings when written before setFindings", () => {
  const context = createContext();

  context.setSection("overview", "## Overview\nOverview content");
  context.setSection("custom-pre", "## Custom Pre\nBefore findings");
  context.setFindings([]);
  context.setSection("summary", "## Summary\nSummary content");

  const result = finalizer.render(context);

  assertTextContainsInOrder(result, [
    "## Overview",
    "## Custom Pre",
    "## Findings",
    "## Summary"
  ]);
});

test("Finalizer renders custom section after findings when written after setFindings", () => {
  const context = createContext();

  context.setSection("overview", "## Overview\nOverview content");
  context.setFindings([]);
  context.setSection("custom-post", "## Custom Post\nAfter findings");
  context.setSection("summary", "## Summary\nSummary content");

  const result = finalizer.render(context);

  assertTextContainsInOrder(result, [
    "## Overview",
    "## Findings",
    "## Custom Post",
    "## Summary"
  ]);
});

// 5.4: default SOP topology produces the same note layout as before
test("Finalizer default SOP topology: overview → deps → knowledge → strategy → Findings → summary", () => {
  const context = createContext();

  context.setSection("overview", "## Overview\nOverview content");
  context.setSection("dependencies-boundaries", "## Dependencies & Boundaries\nDeps content");
  context.setSection("knowledge-source-of-truth", "## Knowledge\nKnowledge content");
  context.setSection("strategy-what-if-scenarios", "## Strategy\nStrategy content");
  context.setFindings([makeMustFinding("issue-1")]);
  context.setFindings([makeMustFinding("issue-1")]); // second call, index unchanged
  context.setSection("summary", "## Summary\nSummary content");

  const result = finalizer.render(context);

  assertTextContainsInOrder(result, [
    "## Overview",
    "## Dependencies & Boundaries",
    "## Knowledge",
    "## Strategy",
    "## Findings",
    "## Summary"
  ]);
});

// 5.5: Findings render between pre-index and post-index sections
test("Finalizer splits sections at findingsInsertionIndex", () => {
  const context = createContext();

  context.setSection("a", "## A\nContent A");
  context.setSection("b", "## B\nContent B");
  context.setFindings([makeNiceFinding("suggestion-1")]);
  context.setSection("c", "## C\nContent C");

  const result = finalizer.render(context);

  assertTextContainsInOrder(result, [
    "## A",
    "## B",
    "## Findings",
    "## C"
  ]);
});

// 5.6: no setFindings → no ## Findings block
test("Finalizer renders no Findings block when setFindings never called", () => {
  const context = createContext();

  context.setSection("overview", "## Overview\nOverview content");
  context.setSection("custom", "## Custom\nCustom content");

  const result = finalizer.render(context);

  assertTextContainsInOrder(result, [
    "## Overview",
    "## Custom"
  ]);
  assertTextExcludesAll(result, ["## Findings"]);
});

// 5.7: bootstrap snapshot (no sections, no findings)
test("Finalizer renders bootstrap snapshot when empty", () => {
  const context = createContext();

  const result = finalizer.render(context);

  assertBootstrapShape(result, FILE_PATH);
  assert.match(result, /Review not yet generated/u);
  assertTextExcludesAll(result, ["## Findings"]);
});

// 5.8: bootstrap + interruption warning
test("Finalizer renders bootstrap with interruption warning", () => {
  const context = createContext();

  context.markInterrupted("step-1-overview", "model-timeout");

  const result = finalizer.render(context);

  assertBootstrapShape(result, FILE_PATH);
  assert.match(result, /Review not yet generated/u);
  assertWarningBlock(result, { stepId: "step-1-overview", reason: "model-timeout" });
  assertWarningBlockAtEnd(result, { stepId: "step-1-overview", reason: "model-timeout" });
});

// 5.9: partial state (only some sections written)
test("Finalizer renders partial state with some sections", () => {
  const context = createContext();

  context.setSection("overview", "## Overview\nPartial content");

  const result = finalizer.render(context);

  assertBootstrapShape(result, FILE_PATH);
  assertTextContainsInOrder(result, ["## Overview", "Partial content"]);
  assertTextExcludesAll(result, ["## Findings"]);
});

// 5.10: whitespace-only / empty string section not rendered
test("Finalizer filters out whitespace-only and empty sections", () => {
  const context = createContext();

  context.setSection("empty", "");
  context.setSection("whitespace", "   \n  ");
  context.setSection("valid", "## Valid\nReal content");

  const result = finalizer.render(context);

  assertTextContainsInOrder(result, ["## Valid"]);
  assertTextExcludesAll(result, ["## empty", "## whitespace"]);
});

// 5.11: interruption warning renders as final element
test("Finalizer renders interruption warning after all content", () => {
  const context = createContext();

  context.setSection("overview", "## Overview\nOverview content");
  context.setFindings([makeMustFinding("issue-1")]);
  context.setSection("summary", "## Summary\nSummary content");
  context.markInterrupted("step-7-summary", "context-length");

  const result = finalizer.render(context);

  assertTextContainsInOrder(result, [
    "## Overview",
    "## Findings",
    "## Summary",
    "> [!WARNING] Review Interrupted"
  ]);
  assertWarningBlockAtEnd(result, { stepId: "step-7-summary", reason: "context-length" });
});

// 5.12: findings rendering details
test("Finalizer renders empty findings as - 無", () => {
  const context = createContext();

  context.setSection("overview", "## Overview\nContent");
  context.setFindings([]);

  const result = finalizer.render(context);

  assertTextContainsInOrder(result, ["## Findings", "- 無"]);
});

test("Finalizer renders findings stats and must before nice", () => {
  const context = createContext();

  context.setSection("overview", "## Overview\nContent");
  context.setFindings([
    makeNiceFinding("nice-suggestion"),
    makeMustFinding("must-fix-1"),
    makeMustFinding("must-fix-2")
  ]);

  const result = finalizer.render(context);

  assertFindingsStats(result, { must: 2, nice: 1 });
  assertFindingsTitlesInOrder(result, [
    { type: "must", title: "must-fix-1" },
    { type: "must", title: "must-fix-2" },
    { type: "nice", title: "nice-suggestion" }
  ]);
});

test("Finalizer excludes confidence from rendered findings", () => {
  const context = createContext();

  context.setSection("overview", "## Overview\nContent");
  context.setFindings([makeMustFinding("issue-1")]);

  const result = finalizer.render(context);

  assertTextExcludesAll(result, ["confidence", "0.9"]);
});

test("Finalizer renders traceability formats correctly", () => {
  const context = createContext();

  const findings: Finding[] = [
    {
      type: "must",
      title: "line-range-single",
      traceability: { kind: "line-range", lineStart: 42, lineEnd: 42 },
      context: "c", deviation: "d", impact: "i", suggestion: "s", confidence: 0.9
    },
    {
      type: "must",
      title: "line-range-multi",
      traceability: { kind: "line-range", lineStart: 10, lineEnd: 20 },
      context: "c", deviation: "d", impact: "i", suggestion: "s", confidence: 0.9
    },
    {
      type: "must",
      title: "diff-hunk",
      traceability: { kind: "diff-hunk", hunkHeader: "@@ -5,7 +5,7 @@" },
      context: "c", deviation: "d", impact: "i", suggestion: "s", confidence: 0.9
    }
  ];

  context.setSection("overview", "## Overview\nContent");
  context.setFindings(findings);

  const result = finalizer.render(context);

  assertTraceabilityForms(result, ["L42", "L10-L20", "@@ -5,7 +5,7 @@"]);
});
