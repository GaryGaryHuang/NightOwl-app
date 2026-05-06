import assert from "node:assert/strict";
import test from "node:test";

import {
  FileReviewContext,
  type FileReviewContextInput,
  type Finding
} from "../../../src/core/file-review-context.ts";
import { renderReviewNote } from "../../../src/core/finalizers/review-note-finalizer.ts";
import {
  assertBootstrapShape,
  assertFindingsStats,
  assertFindingsTitlesInOrder,
  assertTextContainsInOrder,
  assertTextExcludesAll,
  assertTraceabilityForms,
  assertWarningBlock,
  assertWarningBlockAtEnd
} from "../../helpers/finalizer-contract-fixture.ts";

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
    findingId: "F1",
    classification: "confirmed_problem",
    severity: "high",
    title,
    traceability: { kind: "line-range", lineStart: 1, lineEnd: 1 },
    evidence: "test-evidence",
    triggerCondition: "test-trigger",
    impact: "test-impact",
    counterEvidence: ["test-counter"]
  };
}

function makeNiceFinding(title: string): Finding {
  return {
    findingId: "F2",
    classification: "reasonable_risk",
    severity: "low",
    title,
    traceability: { kind: "diff-hunk", hunkHeader: "@@ -1,3 +1,3 @@" },
    evidence: "test-evidence",
    triggerCondition: "test-trigger",
    impact: "test-impact",
    counterEvidence: ["test-counter"]
  };
}

const finalizer = renderReviewNote;

// 5.2: sections render in insertion order
test("Finalizer renders sections in insertion order", () => {
  const context = createContext();

  context.setSection("overview", "## Overview\nOverview content");
  context.setSection("strategy", "## Strategy\nStrategy content");
  context.setSection("custom-analysis", "## Custom Analysis\nCustom content");
  context.setSection("summary", "## Summary\nSummary content");

  const result = finalizer(context);

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

  const result = finalizer(context);

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

  const result = finalizer(context);

  assertTextContainsInOrder(result, [
    "## Overview",
    "## Findings",
    "## Custom Post",
    "## Summary"
  ]);
});

// 5.4: generic sections retain insertion order around findings and summary
test("Finalizer renders generic sections before Findings and Summary", () => {
  const context = createContext();

  context.setSection("custom-analysis", "## Custom Analysis\nAnalysis content");
  context.setSection("custom-risk-notes", "## Custom Risk Notes\nRisk content");
  context.setFindings([makeMustFinding("issue-1")]);
  context.setFindings([makeMustFinding("issue-1")]); // second call, index unchanged
  context.setSection("summary", "## Summary\nSummary content");

  const result = finalizer(context);

  assertTextContainsInOrder(result, [
    "## Custom Analysis",
    "## Custom Risk Notes",
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

  const result = finalizer(context);

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

  const result = finalizer(context);

  assertTextContainsInOrder(result, [
    "## Overview",
    "## Custom"
  ]);
  assertTextExcludesAll(result, ["## Findings"]);
});

// 5.7: bootstrap snapshot (no sections, no findings)
test("Finalizer renders bootstrap snapshot when empty", () => {
  const context = createContext();

  const result = finalizer(context);

  assertBootstrapShape(result, FILE_PATH);
  assert.match(result, /Review not yet generated/u);
  assertTextExcludesAll(result, ["## Findings"]);
});

// 5.8: bootstrap + interruption warning
test("Finalizer renders bootstrap with interruption warning", () => {
  const context = createContext();

  context.markInterrupted("step7-summary", "model-timeout");

  const result = finalizer(context);

  assertBootstrapShape(result, FILE_PATH);
  assert.match(result, /Review not yet generated/u);
  assertWarningBlock(result, { stepId: "step7-summary", reason: "model-timeout" });
  assertWarningBlockAtEnd(result, { stepId: "step7-summary", reason: "model-timeout" });
});

// 5.9: partial state (only some sections written)
test("Finalizer renders partial state with some sections", () => {
  const context = createContext();

  context.setSection("overview", "## Overview\nPartial content");

  const result = finalizer(context);

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

  const result = finalizer(context);

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

  const result = finalizer(context);

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

  const result = finalizer(context);

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

  const result = finalizer(context);

  assertFindingsStats(result, { must: 2, nice: 1 });
  assertFindingsTitlesInOrder(result, [
    { type: "must", title: "must-fix-1" },
    { type: "must", title: "must-fix-2" },
    { type: "nice", title: "nice-suggestion" }
  ]);
});

test("Finalizer renders missing-information details after Findings", () => {
  const context = createContext();

  context.setSection("overview", "## Overview\nContent");
  context.setFindings([]);
  context.setMissingInformationItems([
    {
      itemId: "MI1",
      description: "Need the ShazamKit callback contract.",
      whyItMatters: "Without it the review cannot prove timeout behavior."
    }
  ]);
  context.setSection("summary", "## Summary\nSummary content");

  const result = finalizer(context);

  assertTextContainsInOrder(result, [
    "## Findings",
    "## Missing Information",
    "- [MI1] Need the ShazamKit callback contract.",
    "Why it matters: Without it the review cannot prove timeout behavior.",
    "## Summary"
  ]);
});

test("Finalizer excludes internal fields from rendered findings", () => {
  const context = createContext();

  context.setSection("overview", "## Overview\nContent");
  context.setFindings([makeMustFinding("issue-1")]);

  const result = finalizer(context);

  assertTextExcludesAll(result, [
    "findingId",
    "supportingEvidence",
    "reachability",
    "uncertaintyStatus",
    "credible",
    "direct code path"
  ]);
});

test("Finalizer renders traceability formats correctly", () => {
  const context = createContext();

  const findings: Finding[] = [
    {
      findingId: "F1",
      classification: "confirmed_problem",
      severity: "high",
      title: "line-range-single",
      traceability: { kind: "line-range", lineStart: 42, lineEnd: 42 },
      evidence: "e", triggerCondition: "t", impact: "i", counterEvidence: []
    },
    {
      findingId: "F2",
      classification: "confirmed_problem",
      severity: "high",
      title: "line-range-multi",
      traceability: { kind: "line-range", lineStart: 10, lineEnd: 20 },
      evidence: "e", triggerCondition: "t", impact: "i", counterEvidence: []
    },
    {
      findingId: "F3",
      classification: "confirmed_problem",
      severity: "high",
      title: "diff-hunk",
      traceability: { kind: "diff-hunk", hunkHeader: "@@ -5,7 +5,7 @@" },
      evidence: "e", triggerCondition: "t", impact: "i", counterEvidence: []
    }
  ];

  context.setSection("overview", "## Overview\nContent");
  context.setFindings(findings);

  const result = finalizer(context);

  assertTraceabilityForms(result, ["L42", "L10-L20", "@@ -5,7 +5,7 @@"]);
});
