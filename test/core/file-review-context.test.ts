import assert from "node:assert/strict";
import test from "node:test";

import {
  FileReviewContext,
  type FileReviewContextInput,
  type Finding
} from "../../src/core/file-review-context.ts";
import type { ReviewBasis } from "../../src/core/review-basis.ts";

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

test("FileReviewContext stores ReviewBasis separately from prose sections", () => {
  const context = createContext();
  const basis = createReviewBasis();

  context.setReviewBasis(basis);

  assert.equal(context.getReviewBasis()?.filePath, "src/app.ts");
  assert.equal(context.getReviewBasis()?.evidenceRefs[0].evidenceId, "E1");
  assert.equal(context.getSection("overview"), undefined);
});

test("FileReviewContext returns defensive ReviewBasis snapshots", () => {
  const context = createContext();
  const basis = createReviewBasis();

  context.setReviewBasis(basis);
  (basis as unknown as { evidenceRefs: [] }).evidenceRefs = [];

  const first = context.getReviewBasis()!;
  (first.evidenceRefs[0] as { summary: string }).summary = "MUTATED";

  const second = context.getReviewBasis()!;
  assert.equal(second.evidenceRefs[0].summary, "review basis state added");
});

test("FileReviewContext stores CandidateFindings separately from approved findings", () => {
  const context = createContext() as SemanticFileReviewContext;
  const candidatePayload = createCandidateFindings();

  context.setCandidateFindings(candidatePayload);

  assert.equal(context.getFindings(), undefined);
  assert.equal(
    context.getCandidateFindings()?.findings[0]?.classification,
    "confirmed_problem"
  );
});

test("FileReviewContext returns defensive CandidateFindings snapshots", () => {
  const context = createContext() as SemanticFileReviewContext;
  const candidatePayload = createCandidateFindings();

  context.setCandidateFindings(candidatePayload);
  candidatePayload.findings[0]!.classification = "reasonable_risk";

  const first = context.getCandidateFindings()!;
  first.findings[0]!.evidence = "MUTATED";
  first.findingOrigins[0]!.rationale = "MUTATED";
  first.hypothesisClosure[0]!.status = "insufficient_information";

  const second = context.getCandidateFindings()!;
  assert.equal(second.findings[0]!.classification, "confirmed_problem");
  assert.equal(second.findings[0]!.evidence, "changed branch reads value before fallback; guard runs after dereference");
  assert.equal(second.findingOrigins[0]!.rationale, "candidate covers H1");
  assert.equal(second.hypothesisClosure[0]!.status, "closed_by_candidate");
});

test("FileReviewContext stores ValidationReportV1 and missing-information state defensively", () => {
  const context = createContext() as SemanticFileReviewContext;
  const report = createValidationReportV1();

  context.setValidationReportV1(report);
  context.setMissingInformationItems(report.missingInformationItems);
  report.perFindingResults[0]!.findingId = "MUTATED";
  report.missingInformationItems[0]!.description = "MUTATED";

  const storedReport = context.getValidationReportV1()!;
  const storedMissingInfo = context.getMissingInformationItems()!;
  storedReport.perFindingResults[0]!.findingId = "MUTATED_AGAIN";
  storedMissingInfo[0]!.description = "MUTATED_AGAIN";

  assert.equal(context.getValidationReportV1()?.perFindingResults[0]?.findingId, "F1");
  assert.equal(
    context.getMissingInformationItems()?.[0]?.description,
    "Need the external null-input contract."
  );
});

test("FileReviewContext stores interruption state separately and returns defensive copies", () => {
  const context = createContext();

  context.markInterrupted(
    "candidate-findings",
    "deterministic validation failed"
  );

  assert.deepEqual(context.getInterruption(), {
    stepId: "candidate-findings",
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
    stepId: "candidate-findings",
    reason: "deterministic validation failed"
  });
});

test("FileReviewContext setFindings deep-clones nested finding fields so mutations do not leak", () => {
  const context = createContext();

  const original: Finding = {
    findingId: "F1",
    classification: "confirmed_problem",
    severity: "high",
    title: "leak test",
    traceability: { kind: "line-range", lineStart: 1, lineEnd: 2 },
    evidence: "concrete evidence",
    triggerCondition: "trigger",
    impact: "imp",
    counterEvidence: ["checked"],
    dependencyPathException: {
      reason: "dependency path",
      dependencyAnchor: { filePath: "src/dep.ts", symbol: "helper" }
    }
  };

  context.setFindings([original]);

  // Mutate the original object after setFindings
  original.traceability = { kind: "line-range", lineStart: 99, lineEnd: 99 };
  original.dependencyPathException!.reason = "MUTATED";
  original.dependencyPathException!.dependencyAnchor.symbol = "MUTATED";
  original.findingId = "MUTATED";

  const stored = context.getFindings()!;
  assert.equal(stored.length, 1);
  const f = stored[0]!;

  assert.equal(f.findingId, "F1");
  assert.deepEqual(f.traceability, { kind: "line-range", lineStart: 1, lineEnd: 2 });
  assert.equal(f.dependencyPathException?.reason, "dependency path");
  assert.equal(f.dependencyPathException?.dependencyAnchor.symbol, "helper");
});

test("FileReviewContext getFindings returns defensively cloned copies", () => {
  const context = createContext();

  context.setFindings([
    {
      findingId: "F1",
      classification: "confirmed_problem",
      severity: "high",
      title: "defensive clone",
      traceability: { kind: "line-range", lineStart: 1, lineEnd: 2 },
      evidence: "concrete evidence",
      triggerCondition: "trigger",
      impact: "impact",
      counterEvidence: ["checked"],
      dependencyPathException: {
        reason: "dependency path",
        dependencyAnchor: { filePath: "src/dep.ts", symbol: "helper" }
      }
    }
  ]);

  const first = context.getFindings()!;
  first[0]!.findingId = "MUTATED";
  first[0]!.traceability = { kind: "line-range", lineStart: 99, lineEnd: 99 };
  first[0]!.dependencyPathException!.dependencyAnchor.symbol = "MUTATED";

  const second = context.getFindings()!;
  assert.equal(second[0]!.findingId, "F1");
  assert.deepEqual(second[0]!.traceability, { kind: "line-range", lineStart: 1, lineEnd: 2 });
  assert.equal(second[0]!.dependencyPathException!.dependencyAnchor.symbol, "helper");
});

function createContext(
  overrides: Partial<FileReviewContextInput> = {}
): FileReviewContext {
  return new FileReviewContext({
    ...DEFAULT_CONTEXT_INPUT,
    ...overrides
  });
}

type SemanticFileReviewContext = FileReviewContext & {
  setCandidateFindings(payload: ReturnType<typeof createCandidateFindings>): void;
  getCandidateFindings(): ReturnType<typeof createCandidateFindings> | undefined;
  setValidationReportV1(report: ReturnType<typeof createValidationReportV1>): void;
  getValidationReportV1(): ReturnType<typeof createValidationReportV1> | undefined;
  setMissingInformationItems(items: ReturnType<typeof createValidationReportV1>["missingInformationItems"]): void;
  getMissingInformationItems(): ReturnType<typeof createValidationReportV1>["missingInformationItems"] | undefined;
};

function createCandidateFindings() {
  return {
    result: "FINDINGS_READY",
    findings: [
      {
        findingId: "F1",
        classification: "confirmed_problem",
        severity: "high",
        title: "guard moved after dereference",
        traceability: { kind: "line-range" as const, lineStart: 1, lineEnd: 1 },
        evidence: "changed branch reads value before fallback; guard runs after dereference",
        triggerCondition: "nullable input reaches the changed branch",
        impact: "request fails before fallback can run",
        counterEvidence: ["fallback no longer precedes dereference"]
      }
    ],
    findingOrigins: [
      {
        findingIndex: 1,
        kind: "hypothesis",
        hypothesisIds: ["H1"],
        evidenceIds: ["E1"],
        rationale: "candidate covers H1"
      }
    ],
    hypothesisClosure: [
      {
        hypothesisId: "H1",
        status: "closed_by_candidate",
        rationale: "F1 validates the hypothesis."
      }
    ],
    criticalMissingInformation: []
  };
}

function createValidationReportV1() {
  return {
    perFindingResults: [
      {
        findingId: "F1",
        decision: "rewrite_required",
        failedGates: ["completeness"],
        requiredCorrections: [],
        reason: "external contract is unavailable"
      }
    ],
    missingInformationItems: [
      {
        itemId: "MI1",
        description: "Need the external null-input contract.",
        whyItMatters: "Without it the validator cannot prove expected behavior."
      }
    ],
    loopControl: { action: "accept", reason: "missing critical contract" }
  };
}

function createReviewBasis(): ReviewBasis {
  return {
    filePath: "src/app.ts",
    roleInChangeset: "Owns review prompt harness state handoff.",
    changedBehavior: [
      {
        before: "Candidate Findings consumed prose sections.",
        after: "Candidate Findings consumes ReviewBasis evidence graph.",
        evidenceIds: ["E1"]
      }
    ],
    facts: [
      {
        statement: "ReviewBasis is emitted before Candidate Findings.",
        evidenceIds: ["E1"]
      }
    ],
    inferences: [
      {
        statement: "Candidate Findings can validate source evidence IDs.",
        basedOnEvidenceIds: ["E1"],
        confidence: "high"
      }
    ],
    dependencyMap: {
      upstreamCallers: ["ReviewOrchestrator"],
      downstreamConsumers: ["CandidateFindingsStep"],
      externalContracts: [],
      sharedStateOrSideEffects: ["FileReviewContext"]
    },
    flowMap: {
      entryPoints: ["ReviewBasisStep.prepare"],
      stateTransitions: ["setReviewBasis"],
      asyncBoundaries: [],
      errorPaths: ["validator rejects missing evidence"]
    },
    hypothesisLedger: [
      {
        hypothesisId: "H1",
        statement: "Evidence refs may be missing.",
        triggerCondition: "Candidate Findings cites absent evidence ID.",
      }
    ],
    missingInformation: [],
    evidenceRefs: [
      {
        evidenceId: "E1",
        sourceType: "diff",
        location: "src/app.ts:1",
        summary: "review basis state added"
      }
    ]
  };
}
