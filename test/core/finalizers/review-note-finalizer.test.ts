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

const finalizer = renderReviewNote;

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

function assertFindingsStats(
  text: string,
  counts: { must: number; nice: number }
): void {
  assertTextContainsAll(text, [
    `${counts.must} must-fix issue(s), ${counts.nice} nice-to-have suggestion(s).`
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
    values.map((value) => `- Traceability: ${value}`)
  );
}

function assertWarningBlock(
  text: string,
  input: { stepId: string; reason: string }
): void {
  assertTextContainsAll(text, [
    "> [!WARNING] Review Interrupted",
    `> 本檔案在執行 ${input.stepId} 時失敗（原因：${input.reason}），後續審查已略過。`
  ]);
}

function assertWarningBlockAtEnd(
  text: string,
  input: { stepId: string; reason: string }
): void {
  const warningBlock = [
    "> [!WARNING] Review Interrupted",
    `> 本檔案在執行 ${input.stepId} 時失敗（原因：${input.reason}），後續審查已略過。`
  ].join("\n");

  assert.ok(
    text.endsWith(warningBlock),
    "expected warning block to be the final rendered content"
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

// 5.2: sections render in insertion order
test("Finalizer renders sections in insertion order", () => {
  const context = createContext();

  context.setSection("review-basis", "## Review Basis\nReview basis content");
  context.setSection("candidate-findings", "## Candidate Findings\nCandidate findings content");
  context.setSection("custom-analysis", "## Custom Analysis\nCustom content");
  context.setSection("summary", "## Summary\nSummary content");

  const result = finalizer(context);

  assertTextContainsInOrder(result, [
    "## Review Basis",
    "## Candidate Findings",
    "## Custom Analysis",
    "## Summary"
  ]);
});

// 5.3: custom section relative to findings anchor
test("Finalizer renders custom section before findings when written before setFindings", () => {
  const context = createContext();

  context.setSection("review-basis", "## Review Basis\nReview basis content");
  context.setSection("custom-pre", "## Custom Pre\nBefore findings");
  context.setFindings([]);
  context.setSection("summary", "## Summary\nSummary content");

  const result = finalizer(context);

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

  const result = finalizer(context);

  assertTextContainsInOrder(result, [
    "## Review Basis",
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

  context.setSection("review-basis", "## Review Basis\nReview basis content");
  context.setSection("custom", "## Custom\nCustom content");

  const result = finalizer(context);

  assertTextContainsInOrder(result, [
    "## Review Basis",
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

  context.markInterrupted("review-summary", "model-timeout");

  const result = finalizer(context);

  assertBootstrapShape(result, FILE_PATH);
  assert.match(result, /Review not yet generated/u);
  assertWarningBlock(result, { stepId: "review-summary", reason: "model-timeout" });
  assertWarningBlockAtEnd(result, { stepId: "review-summary", reason: "model-timeout" });
});

// 5.9: partial state (only some sections written)
test("Finalizer renders partial state with some sections", () => {
  const context = createContext();

  context.setSection("review-basis", "## Review Basis\nPartial content");

  const result = finalizer(context);

  assertBootstrapShape(result, FILE_PATH);
  assertTextContainsInOrder(result, ["## Review Basis", "Partial content"]);
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

  context.setSection("review-basis", "## Review Basis\nReview basis content");
  context.setFindings([makeMustFinding("issue-1")]);
  context.setSection("summary", "## Summary\nSummary content");
  context.markInterrupted("review-summary", "context-length");

  const result = finalizer(context);

  assertTextContainsInOrder(result, [
    "## Review Basis",
    "## Findings",
    "## Summary",
    "> [!WARNING] Review Interrupted"
  ]);
  assertWarningBlockAtEnd(result, { stepId: "review-summary", reason: "context-length" });
});

// 5.12: findings rendering details
test("Finalizer renders empty findings as - 無", () => {
  const context = createContext();

  context.setSection("review-basis", "## Review Basis\nContent");
  context.setFindings([]);

  const result = finalizer(context);

  assertTextContainsInOrder(result, ["## Findings", "- 無"]);
});

test("Finalizer renders findings stats and must before nice", () => {
  const context = createContext();

  context.setSection("review-basis", "## Review Basis\nContent");
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

  const result = finalizer(context);

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

  const result = finalizer(context);

  assertTraceabilityForms(result, ["L42", "L10-L20", "@@ -5,7 +5,7 @@"]);
});
