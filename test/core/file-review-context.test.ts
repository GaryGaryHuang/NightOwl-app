import assert from "node:assert/strict";
import test from "node:test";

import {
  FileReviewContext,
  type FileReviewContextInput,
  type Finding,
  type FindingDisposition
} from "../../src/core/file-review-context.ts";
import type { ReviewBasisV1 } from "../../src/core/review-basis.ts";
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

test("FileReviewContext stores ReviewBasisV1 separately from prose sections", () => {
  const context = createContext();
  const basis = createReviewBasis();

  context.setReviewBasis(basis);

  assert.equal(context.getReviewBasis()?.filePath, "src/app.ts");
  assert.equal(context.getReviewBasis()?.evidenceRefs[0].evidenceId, "E1");
  assert.equal(context.getSection("overview"), undefined);
});

test("FileReviewContext returns defensive ReviewBasisV1 snapshots", () => {
  const context = createContext();
  const basis = createReviewBasis();

  context.setReviewBasis(basis);
  (basis as unknown as { evidenceRefs: [] }).evidenceRefs = [];

  const first = context.getReviewBasis()!;
  (first.evidenceRefs[0] as { summary: string }).summary = "MUTATED";
  (
    first.hypothesisLedger[0].closureCriteria as unknown as string[]
  ).push("MUTATED");

  const second = context.getReviewBasis()!;
  assert.equal(second.evidenceRefs[0].summary, "review basis state added");
  assert.deepEqual(second.hypothesisLedger[0].closureCriteria, [
    "Every cited evidence ID exists."
  ]);
});

test("FileReviewContext stores CandidateFindingsV3 separately from approved findings", () => {
  const context = createContext() as SemanticFileReviewContext;
  const candidatePayload = createCandidateFindingsV3();

  context.setCandidateFindingsV3(candidatePayload);

  assert.equal(context.getFindings(), undefined);
  assert.equal(context.getCandidateFindingsV3()?.schemaVersion, 3);
  assert.equal(
    context.getCandidateFindingsV3()?.findings[0]?.classification,
    "confirmed_problem"
  );
});

test("FileReviewContext returns defensive CandidateFindingsV3 snapshots", () => {
  const context = createContext() as SemanticFileReviewContext;
  const candidatePayload = createCandidateFindingsV3();

  context.setCandidateFindingsV3(candidatePayload);
  candidatePayload.findings[0]!.classification = "insufficient_information";

  const first = context.getCandidateFindingsV3()!;
  first.findings[0]!.codeEvidence[0]!.evidenceId = "MUTATED";
  first.hypothesisClosure[0]!.status = "insufficient_information";

  const second = context.getCandidateFindingsV3()!;
  assert.equal(second.findings[0]!.classification, "confirmed_problem");
  assert.equal(second.findings[0]!.codeEvidence[0]!.evidenceId, "E1");
  assert.equal(second.hypothesisClosure[0]!.status, "closed_by_candidate");
});

test("FileReviewContext stores ValidationReportV1 and missing-information state defensively", () => {
  const context = createContext() as SemanticFileReviewContext;
  const report = createValidationReportV1();

  context.setValidationReportV1(report);
  context.setMissingInformationItems(report.missingInformationItems);
  report.approvedFindings[0]!.findingId = "MUTATED";
  report.missingInformationItems[0]!.description = "MUTATED";

  const storedReport = context.getValidationReportV1()!;
  const storedMissingInfo = context.getMissingInformationItems()!;
  storedReport.approvedFindings[0]!.findingId = "MUTATED_AGAIN";
  storedMissingInfo[0]!.description = "MUTATED_AGAIN";

  assert.equal(context.getValidationReportV1()?.approvedFindings[0]?.findingId, "F1");
  assert.equal(
    context.getMissingInformationItems()?.[0]?.description,
    "Need the external null-input contract."
  );
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

test("FileReviewContext setFindings deep-clones nested finding fields so mutations do not leak", () => {
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
    findingId: "F1",
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
      type: "must",
      title: "defensive clone",
      traceability: { kind: "line-range", lineStart: 1, lineEnd: 2 },
      expectedBehavior: "expected",
      actualBehavior: "actual",
      deviation: "dev",
      impact: "impact",
      suggestion: "suggestion",
      findingId: "F1",
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
    gate: "disposition",
    reason: "candidate retired: REACHABILITY - path is not reachable"
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
      gate: "disposition",
      reason: "candidate retired: REACHABILITY - path is not reachable"
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

type SemanticFileReviewContext = FileReviewContext & {
  setCandidateFindingsV3(payload: ReturnType<typeof createCandidateFindingsV3>): void;
  getCandidateFindingsV3(): ReturnType<typeof createCandidateFindingsV3> | undefined;
  setValidationReportV1(report: ReturnType<typeof createValidationReportV1>): void;
  getValidationReportV1(): ReturnType<typeof createValidationReportV1> | undefined;
  setMissingInformationItems(items: ReturnType<typeof createValidationReportV1>["missingInformationItems"]): void;
  getMissingInformationItems(): ReturnType<typeof createValidationReportV1>["missingInformationItems"] | undefined;
};

function createCandidateFindingsV3() {
  return {
    schemaVersion: 3,
    result: "FINDINGS_READY",
    findings: [
      {
        findingId: "F1",
        sourceHypothesisIds: ["H1"],
        classification: "confirmed_problem",
        priority: "must",
        severity: "high",
        confidence: "high",
        evidenceStrength: "direct",
        title: "guard moved after dereference",
        traceability: { kind: "line-range" as const, lineStart: 1, lineEnd: 1 },
        codeEvidence: [
          {
            evidenceId: "E1",
            location: "src/app.ts:1",
            summary: "changed branch reads value before fallback"
          }
        ],
        executionPath: ["entry receives nullable input", "changed branch reads value"],
        triggerCondition: "nullable input reaches the changed branch",
        failureMechanism: "guard runs after dereference",
        impact: "request fails before fallback can run",
        counterEvidenceChecked: ["fallback no longer precedes dereference"],
        reproducibility: "deterministic with nullable input",
        fixDirection: "restore guard before dereference",
        testRecommendation: "add nullable input regression coverage"
      }
    ],
    hypothesisClosure: [
      {
        hypothesisId: "H1",
        status: "closed_by_candidate",
        evidenceIds: ["E1"],
        rationale: "F1 validates the hypothesis."
      }
    ],
    criticalMissingInformation: []
  };
}

function createValidationReportV1() {
  return {
    schemaVersion: 1,
    overallStatus: "INSUFFICIENT_INFORMATION_FOR_RELIABLE_REVIEW",
    perFindingResults: [
      {
        findingId: "F1",
        decision: "convert_to_missing_information",
        failedGates: ["missing_information_honest"],
        requiredCorrections: [],
        reason: "external contract is unavailable"
      }
    ],
    approvedFindings: [
      {
        type: "must" as const,
        title: "guard moved after dereference",
        traceability: { kind: "line-range" as const, lineStart: 1, lineEnd: 1 },
        expectedBehavior: "nullable input returns fallback",
        actualBehavior: "changed branch reads value first",
        deviation: "fallback no longer runs before dereference",
        impact: "request fails before fallback can run",
        suggestion: "restore guard before dereference",
        findingId: "F1",
        sourceHypothesisId: "H1"
      }
    ],
    missingInformationItems: [
      {
        itemId: "MI1",
        findingId: "F1",
        description: "Need the external null-input contract.",
        whyItMatters: "Without it the validator cannot prove expected behavior."
      }
    ],
    loopControl: { action: "stop", reason: "missing critical contract" },
    stopReason: "missing_critical_contract"
  };
}

function createReviewBasis(): ReviewBasisV1 {
  return {
    schemaVersion: 1,
    filePath: "src/app.ts",
    roleInChangeset: "Owns review prompt harness state handoff.",
    changedBehavior: [
      {
        changeId: "CB1",
        before: "Step 5 consumed prose sections.",
        after: "Step 5 consumes ReviewBasis evidence graph.",
        evidenceIds: ["E1"]
      }
    ],
    facts: [
      {
        factId: "FCT1",
        statement: "ReviewBasis is emitted before Step 5.",
        evidenceIds: ["E1"]
      }
    ],
    inferences: [
      {
        inferenceId: "INF1",
        statement: "Step 5 can validate source evidence IDs.",
        basedOnEvidenceIds: ["E1"],
        confidence: "high"
      }
    ],
    dependencyMap: {
      upstreamCallers: ["ReviewOrchestrator"],
      downstreamConsumers: ["Step5ValidationInterrogationStep"],
      externalContracts: [],
      sharedStateOrSideEffects: ["FileReviewContext"]
    },
    flowMap: {
      entryPoints: ["ReviewBasisStep.prepare"],
      stateTransitions: ["setReviewBasis"],
      asyncBoundaries: [],
      errorPaths: ["validator rejects missing evidence"]
    },
    testCoverage: {
      changedTests: ["test/core/file-review-context.test.ts"],
      observedCoverageSignals: ["context tests"],
      coverageGaps: []
    },
    identifierRegistry: {
      files: ["src/app.ts"],
      symbols: ["ReviewBasisV1"],
      resourceKeys: [],
      apiNames: [],
      stateNames: ["reviewBasis"]
    },
    hypothesisLedger: [
      {
        hypothesisId: "H1",
        statement: "Evidence refs may be missing.",
        triggerCondition: "Step 5 cites absent evidence ID.",
        whyRelevantHere: "Phase 1 adds evidence refs.",
        closureCriteria: ["Every cited evidence ID exists."]
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
