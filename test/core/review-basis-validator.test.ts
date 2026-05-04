import assert from "node:assert/strict";
import test from "node:test";

import {
  ReviewBasisValidationError,
  ReviewBasisValidator
} from "../../src/core/review-basis-validator.ts";

function makeValidReviewBasis(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
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
      changedTests: ["test/core/review-basis-validator.test.ts"],
      observedCoverageSignals: ["validator tests"],
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
    ],
    ...overrides
  });
}

function expectFailure(fn: () => void): ReviewBasisValidationError {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof ReviewBasisValidationError);
    return error;
  }
  throw new Error("expected ReviewBasisValidationError");
}

test("ReviewBasisValidator accepts a complete ReviewBasisV1", () => {
  const basis = new ReviewBasisValidator().validate(makeValidReviewBasis());

  assert.equal(basis.schemaVersion, 1);
  assert.equal(basis.filePath, "src/app.ts");
  assert.equal(basis.evidenceRefs[0].evidenceId, "E1");
  assert.equal(basis.hypothesisLedger[0].hypothesisId, "H1");
  assert.ok(Object.isFrozen(basis));
  assert.ok(Object.isFrozen(basis.evidenceRefs));
});

test("ReviewBasisValidator rejects duplicate evidence IDs", () => {
  const error = expectFailure(() =>
    new ReviewBasisValidator().validate(
      makeValidReviewBasis({
        evidenceRefs: [
          { evidenceId: "E1", sourceType: "diff", location: "a", summary: "a" },
          { evidenceId: "E1", sourceType: "file", location: "b", summary: "b" }
        ]
      })
    )
  );

  assert.match(error.message, /duplicate evidenceId/u);
});

test("ReviewBasisValidator rejects references to missing evidence IDs", () => {
  const error = expectFailure(() =>
    new ReviewBasisValidator().validate(
      makeValidReviewBasis({
        facts: [{ factId: "FCT1", statement: "missing evidence", evidenceIds: ["E404"] }]
      })
    )
  );

  assert.match(error.message, /E404/u);
});

test("ReviewBasisValidator rejects duplicate hypothesis IDs", () => {
  const duplicate = {
    hypothesisId: "H1",
    statement: "duplicate",
    triggerCondition: "duplicate",
    whyRelevantHere: "duplicate",
    closureCriteria: ["close it"]
  };

  const error = expectFailure(() =>
    new ReviewBasisValidator().validate(
      makeValidReviewBasis({ hypothesisLedger: [duplicate, duplicate] })
    )
  );

  assert.match(error.message, /duplicate hypothesisId/u);
});

test("ReviewBasisValidator rejects hypotheses without closure criteria", () => {
  const error = expectFailure(() =>
    new ReviewBasisValidator().validate(
      makeValidReviewBasis({
        hypothesisLedger: [
          {
            hypothesisId: "H1",
            statement: "missing closure",
            triggerCondition: "runtime path",
            whyRelevantHere: "important",
            closureCriteria: []
          }
        ]
      })
    )
  );

  assert.match(error.message, /closureCriteria/u);
});
