import assert from "node:assert/strict";
import test from "node:test";

import { FileReviewContext, type Finding } from "../../../src/core/file-review-context.ts";
import type { ReviewBasisV1 } from "../../../src/core/review-basis.ts";
import { REVIEW_TURN_TIMEOUT_MS } from "../../../src/core/review-runtime-contract.ts";
import { ReviewStatePromptSerializer } from "../../../src/core/review-state-prompt-serializer.ts";
import {
  CANDIDATE_CLASSIFICATIONS,
  CANDIDATE_SEVERITIES,
  HYPOTHESIS_CLOSURE_STATUSES,
  LOOP_ACTIONS,
  VALIDATION_DECISIONS
} from "../../../src/core/semantic-review.ts";
import { CandidateFindingsStep } from "../../../src/core/steps/candidate-findings-step.ts";
import { SemanticValidationStep } from "../../../src/core/steps/semantic-validation-step.ts";

function createContext(findings: Finding[] = []): FileReviewContext {
  const context = new FileReviewContext({
    filePath: "src/app.ts",
    noteFilePath: "/tmp/src__app.ts.md",
    diffContent: "@@ -1 +1 @@\n-old\n+new\n",
    baseRef: "main",
    headRef: "feature"
  });

  context.setReviewBasis(createReviewBasis());
  if (findings.length > 0) {
    context.setFindings(findings);
  }

  return context;
}

const serializer = new ReviewStatePromptSerializer();

function parseReviewStateFromPrompt(prompt: string): unknown {
  return parseJsonBlock(prompt, "review_state");
}

function parseJsonBlock(prompt: string, blockName: string): unknown {
  const pattern = new RegExp(
    `<${blockName} format="json">\\n([\\s\\S]*?)\\n</${blockName}>`,
    "u"
  );
  const match = prompt.match(pattern);
  assert.ok(match, `${blockName} JSON block should be present`);
  return JSON.parse(match[1]);
}

test("CandidateFindingsStep wires ReviewBasis and CandidateFindingsV3 harness contract", () => {
  const step = new CandidateFindingsStep({ promptSerializer: serializer });
  const context = createContext();
  const plan = step.prepare(context);
  const expectedReviewBasis = createReviewBasis();
  const reviewBasisBlock = parseJsonBlock(plan.prompt.userMessage, "review_basis");
  const reviewState = parseReviewStateFromPrompt(plan.prompt.userMessage) as {
    reviewBasis: ReviewBasisV1 | null;
    hypothesisLedger: ReviewBasisV1["hypothesisLedger"];
    validationFeedback: unknown;
    candidateFindings: unknown;
  };

  assert.equal(plan.reviewProfile.knowledgeMode, "built-in-context7");
  assert.equal(plan.reviewProfile.timeoutMs, REVIEW_TURN_TIMEOUT_MS);
  assert.equal(plan.reviewProfile.model, "gpt-5.4-mini");
  assert.match(
    plan.prompt.userMessage,
    /<diff path="src\/app\.ts" base="main" head="feature">/u
  );
  assert.deepEqual(reviewBasisBlock, expectedReviewBasis);
  assert.deepEqual(reviewState.reviewBasis, expectedReviewBasis);
  assert.deepEqual(reviewState.hypothesisLedger, expectedReviewBasis.hypothesisLedger);
  assert.equal(reviewState.validationFeedback, null);
  assert.equal(reviewState.candidateFindings, null);

  for (const field of [
    "findings",
    "classification",
    "severity",
    "title",
    "traceability",
    "evidence",
    "triggerCondition",
    "impact",
    "counterEvidence",
    "hypothesisClosure",
    "hypothesisId",
    "status",
    "rationale",
    "criticalMissingInformation",
    "description",
    "whyItMatters"
  ]) {
    assert.match(plan.prompt.userMessage, new RegExp(field, "u"));
  }
  for (const value of CANDIDATE_CLASSIFICATIONS) {
    assert.match(plan.prompt.userMessage, new RegExp(`"${value}"`, "u"));
  }
  for (const value of CANDIDATE_SEVERITIES) {
    assert.match(plan.prompt.userMessage, new RegExp(`"${value}"`, "u"));
  }
  for (const value of HYPOTHESIS_CLOSURE_STATUSES) {
    assert.match(plan.prompt.userMessage, new RegExp(`"${value}"`, "u"));
  }
});

test("CandidateFindingsStep fails before prompt construction without ReviewBasis", () => {
  const context = new FileReviewContext({
    filePath: "src/app.ts",
    noteFilePath: "/tmp/src__app.ts.md",
    diffContent: "@@ -1 +1 @@\n-old\n+new\n",
    baseRef: "main",
    headRef: "feature"
  });
  const step = new CandidateFindingsStep({ promptSerializer: serializer });

  assert.throws(
    () => step.prepare(context),
    /ReviewBasis must exist before Candidate Findings/u
  );
});

function createReviewBasis(): ReviewBasisV1 {
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
    testCoverage: {
      changedTests: [],
      observedCoverageSignals: [],
      coverageGaps: []
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

test("SemanticValidationStep wires candidate state and ValidationReport harness contract", () => {
  const candidatePayload = createCandidateFindingsV3();
  const step = new SemanticValidationStep({ promptSerializer: serializer });
  const context = createContext() as SemanticFileReviewContext;
  context.setCandidateFindingsV3(candidatePayload);
  const plan = step.prepare(context);

  assert.equal(plan.reviewProfile.timeoutMs, REVIEW_TURN_TIMEOUT_MS);
  assert.equal(plan.reviewProfile.model, "gpt-5.4-mini");
  const snapshot = parseReviewStateFromPrompt(plan.prompt.userMessage) as {
    candidateFindings: ReturnType<typeof createCandidateFindingsV3>;
    approvedFindings: Finding[];
    reviewBasis: ReviewBasisV1 | null;
    validationFeedback: unknown;
  };

  assert.deepEqual(snapshot.candidateFindings, candidatePayload);
  assert.deepEqual(snapshot.reviewBasis, createReviewBasis());
  assert.equal(snapshot.validationFeedback, null);
  assert.deepEqual(snapshot.approvedFindings, []);
  assert.equal(plan.prompt.userMessage.includes("<candidate_findings"), false);
  assert.match(plan.prompt.userMessage, /<candidate_ids>\n\["F1"\]\n<\/candidate_ids>/u);

  for (const field of [
    "perFindingResults",
    "findingId",
    "decision",
    "failedGates",
    "requiredCorrections",
    "reason",
    "missingInformationItems",
    "description",
    "whyItMatters",
    "loopControl",
    "action"
  ]) {
    assert.match(plan.prompt.userMessage, new RegExp(field, "u"));
  }
  for (const value of VALIDATION_DECISIONS) {
    assert.match(plan.prompt.userMessage, new RegExp(`"${value}"`, "u"));
  }
  for (const value of LOOP_ACTIONS) {
    assert.match(plan.prompt.userMessage, new RegExp(`"${value}"`, "u"));
  }
});

type SemanticFileReviewContext = FileReviewContext & {
  setCandidateFindingsV3(payload: ReturnType<typeof createCandidateFindingsV3>): void;
};

function createCandidateFindingsV3() {
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
