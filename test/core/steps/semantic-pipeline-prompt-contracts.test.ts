import assert from "node:assert/strict";
import test from "node:test";

import { FileReviewContext, type Finding } from "../../../src/core/file-review-context.ts";
import type { ReviewBasis } from "../../../src/core/review-basis.ts";
import { REVIEW_TURN_TIMEOUT_MS } from "../../../src/core/review-runtime-contract.ts";
import { ReviewStatePromptSerializer } from "../../../src/core/review-state-prompt-serializer.ts";
import type { ValidationReportV1 } from "../../../src/core/semantic-review.ts";
import type { StepResolveServices } from "../../../src/core/step-runner.ts";
import { StructuredOutputValidator } from "../../../src/core/structured-output-validator.ts";
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

test("CandidateFindingsStep wires ReviewBasis and CandidateFindings harness contract", async () => {
  const step = new CandidateFindingsStep({ promptSerializer: serializer });
  const context = createContext();
  const plan = step.prepare(context);
  const expectedReviewBasis = createReviewBasis();
  const reviewBasisBlock = parseJsonBlock(plan.prompt.userMessage, "review_basis");
  const reviewState = parseReviewStateFromPrompt(plan.prompt.userMessage) as {
    reviewBasis: ReviewBasis | null;
    hypothesisLedger: ReviewBasis["hypothesisLedger"];
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

  const candidatePayload = createCandidateFindings();
  const applyTo = await plan.resolve(
    JSON.stringify(candidatePayload),
    createResolveServices()
  );
  applyTo(context);

  assert.deepEqual(context.getCandidateFindings(), candidatePayload);
  assert.equal(context.getFindings(), undefined);
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

test("SemanticValidationStep wires candidate state and ValidationReport harness contract", async () => {
  const candidatePayload = createCandidateFindings();
  const step = new SemanticValidationStep({ promptSerializer: serializer });
  const context = createContext() as SemanticFileReviewContext;
  context.setCandidateFindings(candidatePayload);
  const plan = step.prepare(context);

  assert.equal(plan.reviewProfile.timeoutMs, REVIEW_TURN_TIMEOUT_MS);
  assert.equal(plan.reviewProfile.model, "gpt-5.4-mini");
  const snapshot = parseReviewStateFromPrompt(plan.prompt.userMessage) as {
    candidateFindings: ReturnType<typeof createCandidateFindings>;
    approvedFindings: Finding[];
    reviewBasis: ReviewBasis | null;
    validationFeedback: unknown;
  };

  assert.deepEqual(snapshot.candidateFindings, candidatePayload);
  assert.deepEqual(snapshot.reviewBasis, createReviewBasis());
  assert.equal(snapshot.validationFeedback, null);
  assert.deepEqual(snapshot.approvedFindings, []);
  assert.equal(plan.prompt.userMessage.includes("<candidate_findings"), false);
  assert.match(plan.prompt.userMessage, /<candidate_ids>\n\["F1"\]\n<\/candidate_ids>/u);

  const validationReport = createValidationReport();
  const applyTo = await plan.resolve(
    JSON.stringify(validationReport),
    createResolveServices()
  );
  applyTo(context);

  assert.deepEqual(context.getValidationReportV1(), validationReport);
  assert.deepEqual(context.getMissingInformationItems(), []);
  assert.deepEqual(context.getFindings(), candidatePayload.findings);
});

type SemanticFileReviewContext = FileReviewContext & {
  setCandidateFindings(payload: ReturnType<typeof createCandidateFindings>): void;
};

function createCandidateFindings() {
  return {
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

function createValidationReport(): ValidationReportV1 {
  return {
    perFindingResults: [
      {
        findingId: "F1",
        decision: "approve",
        failedGates: [],
        requiredCorrections: [],
        reason: "semantic gates passed"
      }
    ],
    missingInformationItems: [],
    loopControl: { action: "accept", reason: "semantic gates passed" }
  };
}

function createResolveServices(): StepResolveServices {
  return {
    validator: new StructuredOutputValidator()
  };
}
