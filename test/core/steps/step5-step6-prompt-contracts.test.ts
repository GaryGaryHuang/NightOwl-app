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
import { Step5ValidationInterrogationStep } from "../../../src/core/steps/step5-validation-interrogation.ts";
import { Step6CognitiveSimulationStep } from "../../../src/core/steps/step6-cognitive-simulation.ts";

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
  const match = prompt.match(
    /<review_state format="json">\n([\s\S]*?)\n<\/review_state>/u
  );
  assert.ok(match, "review_state JSON block should be present");
  return JSON.parse(match[1]);
}

test("Step5ValidationInterrogationStep prompt contract requests structured finding fields", () => {
  const step = new Step5ValidationInterrogationStep({ promptSerializer: serializer });
  const plan = step.prepare(createContext());

  assert.equal(plan.reviewProfile.timeoutMs, REVIEW_TURN_TIMEOUT_MS);
  assert.equal(plan.reviewProfile.model, "gpt-5.4-mini");
  assert.match(plan.prompt.systemMessage, /ReviewBasisV1\.hypothesisLedger/u);
  assert.match(plan.prompt.systemMessage, /candidate findings/u);
  assert.match(plan.prompt.systemMessage, /final approved findings/u);
  assert.match(plan.prompt.userMessage, /<review_basis format="json">/u);
  assert.match(plan.prompt.userMessage, /hypothesisLedger/u);
  assert.match(plan.prompt.systemMessage, /Code Locations & Inline Anchors/u);
  assert.match(plan.prompt.systemMessage, /smallest head-side line range/u);
  assert.match(plan.prompt.systemMessage, /changedHeadLines/u);
  assert.match(plan.prompt.systemMessage, /Missing Information Discipline/u);
  assert.match(plan.prompt.systemMessage, /Missing information is not a general uncertainty bucket/u);
  assert.doesNotMatch(plan.prompt.systemMessage, /Every emitted candidate must include/u);
  assert.match(plan.prompt.userMessage, /classification/u);
  assert.match(plan.prompt.userMessage, /counterEvidence/u);
  assert.doesNotMatch(plan.prompt.systemMessage, /unless it is explicitly needed/u);
  assert.match(plan.prompt.userMessage, /hypothesisClosure/u);
  assert.match(plan.prompt.userMessage, /criticalMissingInformation/u);
  assert.match(plan.prompt.userMessage, /Structured-output guardrails/u);
  assert.match(plan.prompt.userMessage, /criticalMissingInformation.+array of objects/u);
  assert.match(plan.prompt.systemMessage, /observable behavior changes to missing information/u);
  assert.match(plan.prompt.userMessage, /silently lose data/u);
  assert.match(plan.prompt.userMessage, /low-severity `reasonable_risk` candidate/u);
  assert.match(plan.prompt.userMessage, /locally provable orchestration risks/u);
  assert.match(plan.prompt.userMessage, /Competing local timeouts/u);
  assert.match(plan.prompt.userMessage, /cancellation races/u);
  assert.match(plan.prompt.userMessage, /null-to-empty normalization/u);
  assert.match(plan.prompt.userMessage, /partial-result loss/u);
  assert.match(plan.prompt.userMessage, /current repo-supported production code/u);
  assert.match(plan.prompt.userMessage, /hypothetical future callers/u);
  assert.match(plan.prompt.userMessage, /omitted optional parameters/u);
  assert.doesNotMatch(plan.prompt.systemMessage, /\[假設\]|\[待確認\]/u);
  assert.match(plan.prompt.systemMessage, /Structured JSON Output/u);
  assert.match(plan.prompt.systemMessage, /JSON Completion/u);
  for (const value of CANDIDATE_CLASSIFICATIONS) {
    assert.match(plan.prompt.userMessage, new RegExp(`"${value}"`, "u"));
  }
  for (const value of CANDIDATE_SEVERITIES) {
    assert.match(plan.prompt.userMessage, new RegExp(`"${value}"`, "u"));
  }
  for (const value of HYPOTHESIS_CLOSURE_STATUSES) {
    assert.match(plan.prompt.userMessage, new RegExp(`"${value}"`, "u"));
  }
  assert.doesNotMatch(plan.prompt.userMessage, /"sourceHypothesisId"/u);
});

test("Step5ValidationInterrogationStep fails before prompt construction without ReviewBasis", () => {
  const context = new FileReviewContext({
    filePath: "src/app.ts",
    noteFilePath: "/tmp/src__app.ts.md",
    diffContent: "@@ -1 +1 @@\n-old\n+new\n",
    baseRef: "main",
    headRef: "feature"
  });
  const step = new Step5ValidationInterrogationStep({ promptSerializer: serializer });

  assert.throws(
    () => step.prepare(context),
    /ReviewBasis must exist before Step 5/u
  );
});

function createReviewBasis(): ReviewBasisV1 {
  return {
    filePath: "src/app.ts",
    roleInChangeset: "Owns review prompt harness state handoff.",
    changedBehavior: [
      {
        before: "Step 5 consumed prose sections.",
        after: "Step 5 consumes ReviewBasis evidence graph.",
        evidenceIds: ["E1"]
      }
    ],
    facts: [
      {
        statement: "ReviewBasis is emitted before Step 5.",
        evidenceIds: ["E1"]
      }
    ],
    inferences: [
      {
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
      changedTests: [],
      observedCoverageSignals: [],
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

test("Step6CognitiveSimulationStep validates CandidateFindingsV3 and requests ValidationReportV1", () => {
  const candidatePayload = createCandidateFindingsV3();
  const step = new Step6CognitiveSimulationStep({ promptSerializer: serializer });
  const context = createContext() as SemanticFileReviewContext;
  context.setCandidateFindingsV3(candidatePayload);
  const plan = step.prepare(context);

  assert.equal(plan.reviewProfile.timeoutMs, REVIEW_TURN_TIMEOUT_MS);
  assert.equal(plan.reviewProfile.model, "gpt-5.4-mini");
  const snapshot = parseReviewStateFromPrompt(plan.prompt.userMessage) as {
    candidateFindings: ReturnType<typeof createCandidateFindingsV3>;
    approvedFindings: Finding[];
  };

  assert.deepEqual(snapshot.candidateFindings, candidatePayload);
  assert.equal(snapshot.candidateFindings.result, "FINDINGS_READY");
  assert.equal(snapshot.candidateFindings.findings[0]?.findingId, "F1");
  assert.equal(snapshot.candidateFindings.hypothesisClosure[0]?.hypothesisId, "H1");
  assert.deepEqual(snapshot.candidateFindings.criticalMissingInformation, []);
  assert.deepEqual(snapshot.approvedFindings, []);
  assert.equal(plan.prompt.userMessage.includes("<candidate_findings"), false);
  assert.match(plan.prompt.userMessage, /<candidate_ids>\n\["F1"\]\n<\/candidate_ids>/u);
  assert.match(plan.prompt.systemMessage, /Semantic Validation/u);
  assert.match(plan.prompt.systemMessage, /Missing Information Discipline/u);
  assert.match(plan.prompt.userMessage, /ValidationReportV1/u);
  assert.match(plan.prompt.systemMessage, /not a bug hunt/u);
  assert.match(plan.prompt.systemMessage, /Do not introduce new defects/u);
  assert.doesNotMatch(plan.prompt.systemMessage, /rewrite_required/u);
  assert.doesNotMatch(plan.prompt.systemMessage, /Code Locations & Inline Anchors/u);
  assert.doesNotMatch(plan.prompt.systemMessage, /\[假設\]|\[待確認\]/u);
  assert.match(plan.prompt.systemMessage, /Structured JSON Output/u);
  assert.match(plan.prompt.systemMessage, /JSON Completion/u);
  assert.doesNotMatch(plan.prompt.systemMessage, /unless it is explicitly needed/u);
  assert.match(plan.prompt.userMessage, /perFindingResults/u);
  const stepInstruction = plan.prompt.userMessage.split("</review_state>")[1] ?? "";
  assert.doesNotMatch(stepInstruction, /approvedFindings/u);
  assert.match(plan.prompt.userMessage, /missingInformationItems/u);
  assert.match(plan.prompt.systemMessage, /specific user-actionable fact/u);
  assert.match(plan.prompt.userMessage, /user-actionable facts/u);
  assert.match(plan.prompt.userMessage, /hypothetical future caller/u);
  assert.match(plan.prompt.userMessage, /custom test double/u);
  assert.match(plan.prompt.userMessage, /omitted optional parameter/u);
  assert.match(plan.prompt.userMessage, /Do not copy all ReviewBasis or Step 5 missing information/u);
  assert.match(plan.prompt.userMessage, /internal validator\/debug notes/u);
  assert.match(plan.prompt.userMessage, /never use `rerun` when `perFindingResults` is empty/u);
  assert.match(plan.prompt.userMessage, /When `loopControl\.action = "rerun"`/u);
  assert.match(plan.prompt.userMessage, /do not set any `perFindingResults\[\]\.decision` to `approve`/u);
  assert.match(plan.prompt.userMessage, /candidateFindings\.result` is `INSUFFICIENT_INFORMATION/u);
  assert.match(plan.prompt.userMessage, /convert each still-user-actionable `candidateFindings\.criticalMissingInformation` blocker/u);
  assert.match(plan.prompt.userMessage, /no candidate findings to rewrite; preserve blocking missing information/u);
  assert.match(plan.prompt.userMessage, /loopControl/u);
  assert.match(plan.prompt.userMessage, /rerun/u);
  assert.match(plan.prompt.userMessage, /complete candidateFindings CandidateFindingsV3 object/u);
  assert.match(plan.prompt.userMessage, /candidateFindings\.findings/u);
  assert.match(plan.prompt.userMessage, /candidateFindings\.hypothesisClosure/u);
  assert.match(plan.prompt.userMessage, /candidateFindings\.criticalMissingInformation/u);
  for (const value of VALIDATION_DECISIONS) {
    assert.match(plan.prompt.userMessage, new RegExp(`"${value}"`, "u"));
  }
  for (const value of LOOP_ACTIONS) {
    assert.match(plan.prompt.userMessage, new RegExp(`"${value}"`, "u"));
  }
  assert.doesNotMatch(plan.prompt.userMessage, /findingUpdates/u);
  assert.doesNotMatch(plan.prompt.userMessage, /dispositions/u);
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
