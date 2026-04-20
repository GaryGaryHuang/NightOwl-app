import assert from "node:assert/strict";
import test from "node:test";

import {
  FileReviewContext,
  type FileReviewContextInput,
  type Finding,
  type FindingDisposition
} from "../../src/core/file-review-context.ts";
import type { VerifierReportArtifactEntry } from "../../src/core/verifier-report.ts";

const DEFAULT_CONTEXT_INPUT: FileReviewContextInput = {
  filePath: "src/app.ts",
  noteFilePath: "/workspace/.nightowl/review/run/files/src__app.ts.md",
  diffContent: "@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n",
  baseRef: "main",
  headRef: "feature-branch"
};

test("FileReviewContext preserves execution metadata and starts empty", () => {
  const context = createContext();

  assert.equal(context.filePath, DEFAULT_CONTEXT_INPUT.filePath);
  assert.equal(context.noteFilePath, DEFAULT_CONTEXT_INPUT.noteFilePath);
  assert.equal(context.diffContent, DEFAULT_CONTEXT_INPUT.diffContent);
  assert.equal(context.baseRef, DEFAULT_CONTEXT_INPUT.baseRef);
  assert.equal(context.headRef, DEFAULT_CONTEXT_INPUT.headRef);
  assert.equal(context.getSection("overview"), undefined);
  assert.deepEqual(context.getSectionEntries(), []);
  assert.equal(context.getFindings(), undefined);
  assert.equal(context.getInterruption(), undefined);
  assert.equal(context.getFindingsInsertionIndex(), undefined);
});

test("FileReviewContext accepts custom section keys", () => {
  const context = createContext();

  context.setSection("custom-analysis", "custom content");
  assert.equal(context.getSection("custom-analysis"), "custom content");
  assert.deepEqual(context.getSectionEntries(), [["custom-analysis", "custom content"]]);
});

test("FileReviewContext getSection returns undefined for unwritten custom key", () => {
  const context = createContext();

  assert.equal(context.getSection("never-written"), undefined);
});

test("FileReviewContext setSection overwrites same key preserving insertion position", () => {
  const context = createContext();

  context.setSection("overview", "first");
  context.setSection("deps", "second");
  context.setSection("overview", "overwritten");

  assert.equal(context.getSection("overview"), "overwritten");
  const entries = context.getSectionEntries();
  assert.deepEqual(entries, [
    ["overview", "overwritten"],
    ["deps", "second"]
  ]);
});

test("FileReviewContext records findingsInsertionIndex on first setFindings call", () => {
  const context = createContext();

  context.setSection("overview", "o");
  context.setSection("deps", "d");
  context.setSection("knowledge", "k");
  context.setSection("strategy", "s");

  context.setFindings([]);
  assert.equal(context.getFindingsInsertionIndex(), 4);
});

test("FileReviewContext findingsInsertionIndex unchanged on second setFindings call", () => {
  const context = createContext();

  context.setSection("overview", "o");
  context.setSection("deps", "d");

  context.setFindings([]);
  assert.equal(context.getFindingsInsertionIndex(), 2);

  context.setSection("summary", "s");
  context.setFindings([]);
  assert.equal(context.getFindingsInsertionIndex(), 2);
});

test("FileReviewContext getFindingsInsertionIndex returns undefined when setFindings never called", () => {
  const context = createContext();

  context.setSection("overview", "o");
  assert.equal(context.getFindingsInsertionIndex(), undefined);
});

test("FileReviewContext stores interruption state separately and returns defensive copies", () => {
  const context = createContext();

  context.markInterrupted(
    "step5-validation-interrogation",
    "deterministic validation failed"
  );

  assert.deepEqual(context.getInterruption(), {
    stepId: "step5-validation-interrogation",
    reason: "deterministic validation failed"
  });
  assert.equal(context.getSection("overview"), undefined);
  assert.equal(context.getFindings(), undefined);

  const snapshot = context.getInterruption();
  if (!snapshot) {
    throw new Error("expected interruption snapshot");
  }
  snapshot.stepId = "mutated";
  snapshot.reason = "mutated";

  assert.deepEqual(context.getInterruption(), {
    stepId: "step5-validation-interrogation",
    reason: "deterministic validation failed"
  });
});

test("FileReviewContext setFindings deep-clones v2 fields so mutations do not leak", () => {
  const context = createContext();

  const original: Finding = {
    type: "must",
    title: "leak test",
    traceability: { kind: "line-range", lineStart: 1, lineEnd: 2 },
    expectedBehavior: "expected",
    actualBehavior: "actual",
    deviation: "dev",
    impact: "imp",
    suggestion: "sug",
    modelConfidence: 90,
    findingId: "F1",
    supportingEvidence: [
      { evidenceRef: "E1", supports: "expectedBehavior" },
      { evidenceRef: "E2", supports: "actualBehavior" },
      { evidenceRef: "E3", supports: "reachability" },
      { evidenceRef: "E4", supports: "impact" }
    ],
    reachability: {
      credible: true,
      entryPoint: "handleRequest",
      guardsChecked: ["guard checked"]
    },
    uncertaintyStatus: "supported" as const
  };

  context.setFindings([original]);

  // Mutate the original object after setFindings
  original.supportingEvidence[0]!.evidenceRef = "MUTATED";
  original.supportingEvidence[0]!.supports = "impact";
  original.reachability.credible = false;
  original.reachability.entryPoint = "MUTATED";
  original.reachability.guardsChecked[0] = "MUTATED";
  original.findingId = "MUTATED";
  original.uncertaintyStatus = "tentative";

  const stored = context.getFindings()!;
  assert.equal(stored.length, 1);
  const f = stored[0]!;

  assert.equal(f.findingId, "F1");
  assert.equal(f.uncertaintyStatus, "supported");
  assert.equal(f.reachability.credible, true);
  assert.equal(f.reachability.entryPoint, "handleRequest");
  assert.equal(f.reachability.guardsChecked[0], "guard checked");
  assert.equal(f.supportingEvidence[0]!.evidenceRef, "E1");
  assert.equal(f.supportingEvidence[0]!.supports, "expectedBehavior");
});

test("FileReviewContext getFindings returns defensively cloned copies", () => {
  const context = createContext();

  context.setFindings([
    {
      type: "must",
      title: "defensive clone",
      traceability: { kind: "line-range", lineStart: 1, lineEnd: 2 },
      expectedBehavior: "expected",
      actualBehavior: "actual",
      deviation: "dev",
      impact: "impact",
      suggestion: "suggestion",
      modelConfidence: 90,
      findingId: "F1",
      supportingEvidence: [
        { evidenceRef: "E1", supports: "expectedBehavior" },
        { evidenceRef: "E2", supports: "actualBehavior" },
        { evidenceRef: "E3", supports: "reachability" },
        { evidenceRef: "E4", supports: "impact" }
      ],
      reachability: {
        credible: true,
        entryPoint: "handleRequest",
        guardsChecked: ["guard checked"]
      },
      uncertaintyStatus: "supported"
    }
  ]);

  const first = context.getFindings()!;
  first[0]!.findingId = "MUTATED";
  first[0]!.reachability.entryPoint = "MUTATED";
  first[0]!.reachability.guardsChecked[0] = "MUTATED";
  first[0]!.supportingEvidence[0]!.evidenceRef = "MUTATED";

  const second = context.getFindings()!;
  assert.equal(second[0]!.findingId, "F1");
  assert.equal(second[0]!.reachability.entryPoint, "handleRequest");
  assert.equal(second[0]!.reachability.guardsChecked[0], "guard checked");
  assert.equal(second[0]!.supportingEvidence[0]!.evidenceRef, "E1");
});

test("FileReviewContext getDispositions returns undefined before set", () => {
  const context = createContext();

  assert.equal(context.getDispositions(), undefined);
});

test("FileReviewContext setDispositions stores and getDispositions returns deep-cloned copy", () => {
  const context = createContext();

  const dispositions: FindingDisposition[] = [
    {
      findingId: "F1",
      status: "retained",
      reason: "SUPPORTED",
      explanation: "simulation confirms"
    },
    {
      findingId: "F2",
      status: "retired",
      reason: "REACHABILITY",
      explanation: "path is not reachable"
    }
  ];

  context.setDispositions(dispositions);

  const stored = context.getDispositions()!;
  assert.equal(stored.length, 2);
  assert.deepEqual(stored[0], dispositions[0]);
  assert.deepEqual(stored[1], dispositions[1]);

  // Mutate original — should not affect stored
  dispositions[0]!.findingId = "MUTATED";
  dispositions[0]!.status = "modified";
  dispositions[0]!.reason = "ANCHOR";
  dispositions[0]!.explanation = "MUTATED";

  const fresh = context.getDispositions()!;
  assert.equal(fresh[0]!.findingId, "F1");
  assert.equal(fresh[0]!.status, "retained");
  assert.equal(fresh[0]!.reason, "SUPPORTED");
  assert.equal(fresh[0]!.explanation, "simulation confirms");
});

test("FileReviewContext getDispositions returns defensively cloned copies", () => {
  const context = createContext();

  context.setDispositions([
    { findingId: "F1", status: "retained", reason: "SUPPORTED", explanation: "ok" }
  ]);

  const first = context.getDispositions()!;
  first[0]!.findingId = "MUTATED";

  const second = context.getDispositions()!;
  assert.equal(second[0]!.findingId, "F1");
});

test("FileReviewContext getVerifierReportEntries returns undefined before any entries are appended", () => {
  const context = createContext();

  assert.equal(context.getVerifierReportEntries(), undefined);
});

test("FileReviewContext appends verifier report entries preserving order and deep-clones input", () => {
  const context = createContext();
  const first: VerifierReportArtifactEntry = {
    filePath: "src/app.ts",
    stepId: "step5-validation-interrogation",
    findingId: "F1",
    taxonomy: "OK",
    outcome: "accepted",
    gate: "acceptance",
    reason: "passed all acceptance gates"
  };
  const second: VerifierReportArtifactEntry = {
    filePath: "src/app.ts",
    stepId: "step6-cognitive-simulation",
    findingId: "F2",
    taxonomy: "REACHABILITY",
    outcome: "rejected",
    gate: "acceptance",
    reason: "reachability is not credible"
  };

  context.appendVerifierReportEntries([first]);
  context.appendVerifierReportEntries([second]);

  (first as { stepId: string }).stepId = "MUTATED";
  (second as { reason: string }).reason = "MUTATED";

  assert.deepEqual(context.getVerifierReportEntries(), [
    {
      filePath: "src/app.ts",
      stepId: "step5-validation-interrogation",
      findingId: "F1",
      taxonomy: "OK",
      outcome: "accepted",
      gate: "acceptance",
      reason: "passed all acceptance gates"
    },
    {
      filePath: "src/app.ts",
      stepId: "step6-cognitive-simulation",
      findingId: "F2",
      taxonomy: "REACHABILITY",
      outcome: "rejected",
      gate: "acceptance",
      reason: "reachability is not credible"
    }
  ]);
});

test("FileReviewContext getVerifierReportEntries returns defensive snapshot copies", () => {
  const context = createContext();

  context.appendVerifierReportEntries([
    {
      filePath: "src/app.ts",
      stepId: "step5-validation-interrogation",
      findingId: "F1",
      taxonomy: "OK",
      outcome: "accepted",
      gate: "acceptance",
      reason: "passed all acceptance gates"
    }
  ]);

  const snapshot = context.getVerifierReportEntries()!;
  (snapshot[0] as { findingId: string }).findingId = "MUTATED";

  assert.equal(context.getVerifierReportEntries()![0]!.findingId, "F1");
});

function createContext(
  overrides: Partial<FileReviewContextInput> = {}
): FileReviewContext {
  return new FileReviewContext({
    ...DEFAULT_CONTEXT_INPUT,
    ...overrides
  });
}
