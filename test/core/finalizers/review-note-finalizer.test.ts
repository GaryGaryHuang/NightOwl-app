import assert from "node:assert/strict";
import test from "node:test";

import {
  FileReviewContext,
  type FileReviewContextInput,
  type Finding
} from "../../../src/core/file-review-context.ts";
import { renderReviewNote } from "../../../src/core/finalizers/review-note-finalizer.ts";

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
    priority: "must_fix",
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
    priority: "nice_to_have",
    title,
    traceability: { kind: "diff-hunk", hunkHeader: "@@ -1,3 +1,3 @@" },
    evidence: "test-evidence",
    triggerCondition: "test-trigger",
    impact: "test-impact",
    counterEvidence: ["test-counter"]
  };
}

type TextPattern = string | RegExp;

function assertTextContainsAll(
  text: string,
  patterns: TextPattern[]
): void {
  for (const pattern of patterns) {
    if (typeof pattern === "string") {
      assert.match(text, new RegExp(escapeRegExp(pattern), "u"));
      continue;
    }

    assert.match(text, pattern);
  }
}

function assertTextExcludesAll(
  text: string,
  patterns: TextPattern[]
): void {
  for (const pattern of patterns) {
    if (typeof pattern === "string") {
      assert.doesNotMatch(text, new RegExp(escapeRegExp(pattern), "u"));
      continue;
    }

    assert.doesNotMatch(text, pattern);
  }
}

function assertTextContainsInOrder(
  text: string,
  patterns: TextPattern[]
): void {
  let searchStart = 0;

  for (const pattern of patterns) {
    if (typeof pattern === "string") {
      const index = text.indexOf(pattern, searchStart);

      assert.ok(index >= 0, `expected pattern after index ${searchStart}: ${pattern}`);
      searchStart = index + pattern.length;
      continue;
    }

    const flags = pattern.flags.replace(/g|y/gu, "");
    const regex = new RegExp(pattern.source, `${flags}g`);
    const remainingText = text.slice(searchStart);
    const match = regex.exec(remainingText);

    assert.ok(match, `expected pattern after index ${searchStart}: ${String(pattern)}`);
    searchStart += match.index + match[0].length;
  }
}

function assertBootstrapShape(text: string, filePath: string): void {
  assertTextContainsInOrder(text, [
    `# ${filePath}`,
    `- Source file: \`${filePath}\``
  ]);
}

function assertFindingsTitlesInOrder(
  text: string,
  findings: Array<{ type: "must" | "nice"; title: string }>
): void {
  assertTextContainsInOrder(
    text,
    findings.map((finding) => {
      const priority = finding.type === "must" ? "must_fix" : "nice_to_have";
      return `- [${priority}] ${finding.title}`;
    })
  );
}

function assertTraceabilityForms(
  text: string,
  values: string[]
): void {
  assertTextContainsAll(
    text,
    values.map((value) => `(${value})`)
  );
}

function assertWarningBlock(
  text: string,
  input: { stepId: string; reason: string }
): void {
  assertTextContainsAll(text, [
    "> [!WARNING] Review Interrupted",
    `> This file failed while running ${input.stepId} (reason: ${input.reason}); later review steps were skipped.`
  ]);
}

function assertWarningBlockAtEnd(
  text: string,
  input: { stepId: string; reason: string }
): void {
  const warningBlock = [
    "> [!WARNING] Review Interrupted",
    `> This file failed while running ${input.stepId} (reason: ${input.reason}); later review steps were skipped.`
  ].join("\n");

  assert.ok(
    text.endsWith(warningBlock),
    "expected warning block to be the final rendered content"
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

test("Finalizer renders sections in insertion order", () => {
  const context = createContext();

  context.setSection("review-basis", "## Review Basis\nReview basis content");
  context.setSection("candidate-findings", "## Candidate Findings\nCandidate findings content");
  context.setSection("custom-analysis", "## Custom Analysis\nCustom content");
  context.setSection("summary", "## Summary\nSummary content");

  const result = renderReviewNote(context);

  assertTextContainsInOrder(result, [
    "## Review Basis",
    "## Candidate Findings",
    "## Custom Analysis",
    "## Summary"
  ]);
});

test("Finalizer renders custom section before findings when written before setFindings", () => {
  const context = createContext();

  context.setSection("review-basis", "## Review Basis\nReview basis content");
  context.setSection("custom-pre", "## Custom Pre\nBefore findings");
  context.setFindings([]);
  context.setSection("summary", "## Summary\nSummary content");

  const result = renderReviewNote(context);

  assertTextContainsInOrder(result, [
    "## Review Basis",
    "## Custom Pre",
    "## Findings",
    "## Summary"
  ]);
});

test("Finalizer renders custom section after findings when written after setFindings", () => {
  const context = createContext();

  context.setSection("review-basis", "## Review Basis\nReview basis content");
  context.setFindings([]);
  context.setSection("custom-post", "## Custom Post\nAfter findings");
  context.setSection("summary", "## Summary\nSummary content");

  const result = renderReviewNote(context);

  assertTextContainsInOrder(result, [
    "## Review Basis",
    "## Findings",
    "## Custom Post",
    "## Summary"
  ]);
});

test("Finalizer renders generic sections before Findings and Summary", () => {
  const context = createContext();

  context.setSection("custom-analysis", "## Custom Analysis\nAnalysis content");
  context.setSection("custom-risk-notes", "## Custom Risk Notes\nRisk content");
  context.setFindings([makeMustFinding("issue-1")]);
  context.setFindings([makeMustFinding("issue-1")]); // second call, index unchanged
  context.setSection("summary", "## Summary\nSummary content");

  const result = renderReviewNote(context);

  assertTextContainsInOrder(result, [
    "## Custom Analysis",
    "## Custom Risk Notes",
    "## Findings",
    "## Summary"
  ]);
});

test("Finalizer splits sections at findingsInsertionIndex", () => {
  const context = createContext();

  context.setSection("a", "## A\nContent A");
  context.setSection("b", "## B\nContent B");
  context.setFindings([makeNiceFinding("suggestion-1")]);
  context.setSection("c", "## C\nContent C");

  const result = renderReviewNote(context);

  assertTextContainsInOrder(result, [
    "## A",
    "## B",
    "## Findings",
    "## C"
  ]);
});

test("Finalizer renders no Findings block when setFindings never called", () => {
  const context = createContext();

  context.setSection("review-basis", "## Review Basis\nReview basis content");
  context.setSection("custom", "## Custom\nCustom content");

  const result = renderReviewNote(context);

  assertTextContainsInOrder(result, [
    "## Review Basis",
    "## Custom"
  ]);
  assertTextExcludesAll(result, ["## Findings"]);
});

test("Finalizer renders bootstrap snapshot when empty", () => {
  const context = createContext();

  const result = renderReviewNote(context);

  assertBootstrapShape(result, FILE_PATH);
  assert.match(result, /Review not yet generated/u);
  assertTextExcludesAll(result, ["## Findings"]);
});

test("Finalizer renders bootstrap with interruption warning", () => {
  const context = createContext();

  context.markInterrupted("review-summary", "model-timeout");

  const result = renderReviewNote(context);

  assertBootstrapShape(result, FILE_PATH);
  assert.match(result, /Review not yet generated/u);
  assertWarningBlock(result, { stepId: "review-summary", reason: "model-timeout" });
  assertWarningBlockAtEnd(result, { stepId: "review-summary", reason: "model-timeout" });
});

test("Finalizer renders partial state with some sections", () => {
  const context = createContext();

  context.setSection("review-basis", "## Review Basis\nPartial content");

  const result = renderReviewNote(context);

  assertBootstrapShape(result, FILE_PATH);
  assertTextContainsInOrder(result, ["## Review Basis", "Partial content"]);
  assertTextExcludesAll(result, ["## Findings"]);
});

test("Finalizer filters out whitespace-only and empty sections", () => {
  const context = createContext();

  context.setSection("empty", "");
  context.setSection("whitespace", "   \n  ");
  context.setSection("valid", "## Valid\nReal content");

  const result = renderReviewNote(context);

  assertTextContainsInOrder(result, ["## Valid"]);
  assertTextExcludesAll(result, ["## empty", "## whitespace"]);
});

test("Finalizer renders interruption warning after all content", () => {
  const context = createContext();

  context.setSection("review-basis", "## Review Basis\nReview basis content");
  context.setFindings([makeMustFinding("issue-1")]);
  context.setSection("summary", "## Summary\nSummary content");
  context.markInterrupted("review-summary", "context-length");

  const result = renderReviewNote(context);

  assertTextContainsInOrder(result, [
    "## Review Basis",
    "## Findings",
    "## Summary",
    "> [!WARNING] Review Interrupted"
  ]);
  assertWarningBlockAtEnd(result, { stepId: "review-summary", reason: "context-length" });
});

test("Finalizer renders an empty Findings block when findings were finalized as empty", () => {
  const context = createContext();

  context.setSection("review-basis", "## Review Basis\nContent");
  context.setFindings([]);

  const result = renderReviewNote(context);

  assertTextContainsInOrder(result, ["## Findings"]);
});

test("Finalizer renders compact findings with must before nice", () => {
  const context = createContext();

  context.setSection("review-basis", "## Review Basis\nContent");
  context.setFindings([
    makeNiceFinding("nice-suggestion"),
    makeMustFinding("must-fix-1"),
    makeMustFinding("must-fix-2")
  ]);

  const result = renderReviewNote(context);

  assertFindingsTitlesInOrder(result, [
    { type: "must", title: "must-fix-1" },
    { type: "must", title: "must-fix-2" },
    { type: "nice", title: "nice-suggestion" }
  ]);
  assertTextExcludesAll(result, [
    "Evidence：",
    "Trigger Condition：",
    "Impact：",
    "Counter-Evidence："
  ]);
});

test("Finalizer renders missing-information details after Findings", () => {
  const context = createContext();

  context.setSection("review-basis", "## Review Basis\nContent");
  context.setFindings([]);
  context.setMissingInformationItems([
    {
      itemId: "MI1",
      description: "Need the recognition SDK callback contract.",
      whyItMatters: "Without it the review cannot prove timeout behavior."
    }
  ]);
  context.setSection("summary", "## Summary\nSummary content");

  const result = renderReviewNote(context);

  assertTextContainsInOrder(result, [
    "## Findings",
    "## Missing Information",
    "- [MI1] Need the recognition SDK callback contract.",
    "Why it matters: Without it the review cannot prove timeout behavior.",
    "## Summary"
  ]);
});

test("Finalizer excludes internal fields from rendered findings", () => {
  const context = createContext();

  context.setSection("review-basis", "## Review Basis\nContent");
  context.setFindings([makeMustFinding("issue-1")]);

  const result = renderReviewNote(context);

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
      priority: "must_fix",
      title: "line-range-single",
      traceability: { kind: "line-range", lineStart: 42, lineEnd: 42 },
      evidence: "e", triggerCondition: "t", impact: "i", counterEvidence: []
    },
    {
      findingId: "F2",
      priority: "must_fix",
      title: "line-range-multi",
      traceability: { kind: "line-range", lineStart: 10, lineEnd: 20 },
      evidence: "e", triggerCondition: "t", impact: "i", counterEvidence: []
    },
    {
      findingId: "F3",
      priority: "must_fix",
      title: "diff-hunk",
      traceability: { kind: "diff-hunk", hunkHeader: "@@ -5,7 +5,7 @@" },
      evidence: "e", triggerCondition: "t", impact: "i", counterEvidence: []
    }
  ];

  context.setSection("review-basis", "## Review Basis\nContent");
  context.setFindings(findings);

  const result = renderReviewNote(context);

  assertTraceabilityForms(result, ["L42", "L10-L20", "@@ -5,7 +5,7 @@"]);
});
