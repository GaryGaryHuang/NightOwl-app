import assert from "node:assert/strict";
import test from "node:test";

import {
  ReviewBasisValidator,
  type ReviewBasisValidationResult
} from "../../src/core/review-basis-validator.ts";

const FILE_PATH = "src/app.ts";

function makeValidReviewBasis(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
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
    ],
    ...overrides
  });
}

function validateOk(responseText: string): ReviewBasisValidationResult & { ok: true } {
  const result = new ReviewBasisValidator().validate({ responseText, filePath: FILE_PATH });
  assert.ok(result.ok, `expected ok but got diagnostics: ${!result.ok ? result.diagnostics.map((d) => d.message).join("; ") : ""}`);
  return result as ReviewBasisValidationResult & { ok: true };
}

function validateFail(responseText: string): ReviewBasisValidationResult & { ok: false } {
  const result = new ReviewBasisValidator().validate({ responseText, filePath: FILE_PATH });
  assert.equal(result.ok, false);
  return result as ReviewBasisValidationResult & { ok: false };
}

test("ReviewBasisValidator accepts a complete ReviewBasisV1", () => {
  const result = validateOk(makeValidReviewBasis());

  assert.equal(result.value.filePath, FILE_PATH);
  assert.equal(result.value.evidenceRefs[0].evidenceId, "E1");
  assert.equal(result.value.hypothesisLedger[0].hypothesisId, "H1");
  assert.ok(Object.isFrozen(result.value));
  assert.ok(Object.isFrozen(result.value.evidenceRefs));
});

test("ReviewBasisValidator injects host filePath regardless of LLM output", () => {
  const result = validateOk(makeValidReviewBasis());
  assert.equal(result.value.filePath, FILE_PATH);
});

test("ReviewBasisValidator ignores unknown top-level fields", () => {
  const result = validateOk(makeValidReviewBasis({ extraField: "hello", anotherOne: 42 }));
  assert.equal(result.value.roleInChangeset, "Owns review prompt harness state handoff.");
});

test("ReviewBasisValidator accepts any non-empty sourceType string", () => {
  const result = validateOk(makeValidReviewBasis({
    evidenceRefs: [
      { evidenceId: "E1", sourceType: "custom_source", location: "a", summary: "a" }
    ]
  }));
  assert.equal(result.value.evidenceRefs[0].sourceType, "custom_source");
});

test("ReviewBasisValidator allows missing sub-fields in dependencyMap (defaults to empty array)", () => {
  const result = validateOk(makeValidReviewBasis({
    dependencyMap: { upstreamCallers: ["X"] }
  }));
  assert.deepEqual(result.value.dependencyMap.downstreamConsumers, []);
  assert.deepEqual(result.value.dependencyMap.externalContracts, []);
});

test("ReviewBasisValidator rejects hypotheses without triggerCondition", () => {
  const result = validateFail(makeValidReviewBasis({
    hypothesisLedger: [
      {
        hypothesisId: "H1",
        statement: "missing trigger"
      }
    ]
  }));

  assert.ok(result.diagnostics.some((d) => d.message.includes("triggerCondition")));
});

test("ReviewBasisValidator defaults invalid inference confidence to low", () => {
  const result = validateOk(makeValidReviewBasis({
    inferences: [
      {
        statement: "bad confidence",
        basedOnEvidenceIds: ["E1"],
        confidence: "very_high"
      }
    ]
  }));

  assert.equal(result.value.inferences[0]?.confidence, "low");
});

test("ReviewBasisValidator normalizes retired medium inference confidence to low", () => {
  const result = validateOk(makeValidReviewBasis({
    inferences: [
      {
        statement: "retired confidence",
        basedOnEvidenceIds: ["E1"],
        confidence: "medium"
      }
    ]
  }));

  assert.equal(result.value.inferences[0]?.confidence, "low");
});

test("ReviewBasisValidator rejects duplicate and dangling evidence references", () => {
  const duplicateEvidence = validateFail(makeValidReviewBasis({
    evidenceRefs: [
      {
        evidenceId: "E1",
        sourceType: "diff",
        location: "src/app.ts:1",
        summary: "first"
      },
      {
        evidenceId: "E1",
        sourceType: "file",
        location: "src/app.ts:2",
        summary: "duplicate"
      }
    ]
  }));
  assert.ok(
    duplicateEvidence.diagnostics.some((d) => d.message.includes("duplicate"))
  );

  const danglingEvidence = validateFail(makeValidReviewBasis({
    facts: [{ statement: "bad evidence", evidenceIds: ["E404"] }]
  }));
  assert.ok(
    danglingEvidence.diagnostics.some((d) => d.message.includes("E404"))
  );
});

test("ReviewBasisValidator normalizes duplicate hypothesis IDs to stable H IDs", () => {
  const result = validateOk(makeValidReviewBasis({
    hypothesisLedger: [
      {
        hypothesisId: "H1",
        statement: "first",
        triggerCondition: "runtime condition"
      },
      {
        hypothesisId: "H1",
        statement: "duplicate",
        triggerCondition: "other runtime condition"
      }
    ]
  }));

  assert.deepEqual(
    result.value.hypothesisLedger.map((entry) => entry.hypothesisId),
    ["H1", "H2"]
  );
});

test("ReviewBasisValidator rejects malformed missingInformation entries", () => {
  const result = validateFail(makeValidReviewBasis({
    missingInformation: [
      {
        description: "Need SDK contract"
      }
    ]
  }));

  assert.ok(result.diagnostics.some((d) => d.message.includes("whyItMatters")));
});

test("ReviewBasisValidator returns PARSE diagnostic for non-JSON input", () => {
  const result = validateFail("not json at all");
  assert.equal(result.diagnostics[0].code, "PARSE");
});

test("ReviewBasisValidator defaults missing roleInChangeset when basis signals exist", () => {
  const result = validateOk(makeValidReviewBasis({ roleInChangeset: "" }));

  assert.equal(result.value.roleInChangeset, `Changed file under review: ${FILE_PATH}`);
});

test("ReviewBasisValidator rejects an empty object with no usable basis signal", () => {
  const result = validateFail(JSON.stringify({}));

  assert.equal(result.diagnostics[0].code, "SCHEMA");
  assert.ok(result.diagnostics[0].message.includes("hypothesisLedger"));
});

test("ReviewBasisValidator repairs BOM prefix", () => {
  const result = validateOk("\uFEFF" + makeValidReviewBasis());
  assert.equal(result.value.filePath, FILE_PATH);
});

test("ReviewBasisValidator repairs code-fenced JSON", () => {
  const result = validateOk("```json\n" + makeValidReviewBasis() + "\n```");
  assert.equal(result.value.filePath, FILE_PATH);
});

test("ReviewBasisValidator extracts single root object from surrounding text", () => {
  const result = validateOk("Here is the JSON:\n" + makeValidReviewBasis() + "\nDone.");
  assert.equal(result.value.filePath, FILE_PATH);
});
