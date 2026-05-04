import assert from "node:assert/strict";
import test from "node:test";

import { FileReviewContext, type Finding } from "../../../src/core/file-review-context.ts";
import type { ReviewBasisV1 } from "../../../src/core/review-basis.ts";
import { ReviewStatePromptSerializer } from "../../../src/core/review-state-prompt-serializer.ts";
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

  context.setSection("strategy-what-if-scenarios", "## Strategy & What-if Scenarios\nW1: hypothesis");
  context.setReviewBasis(createReviewBasis());
  if (findings.length > 0) {
    context.setFindings(findings);
  }

  return context;
}

function createFinding(findingId: string): Finding {
  return {
    type: "must",
    title: `finding ${findingId}`,
    traceability: { kind: "line-range", lineStart: 1, lineEnd: 1 },
    expectedBehavior: "expected",
    actualBehavior: "actual",
    deviation: "dev",
    impact: "impact",
    suggestion: "suggestion",
    findingId
  };
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

  assert.match(plan.prompt.systemMessage, /ReviewBasisV1\.hypothesisLedger/u);
  assert.match(plan.prompt.userMessage, /<review_basis format="json">/u);
  assert.match(plan.prompt.userMessage, /hypothesisLedger/u);
  assert.match(plan.prompt.systemMessage, /Code Locations & Inline Anchors/u);
  assert.match(plan.prompt.systemMessage, /smallest head-side line range/u);
  assert.match(plan.prompt.systemMessage, /changedHeadLines/u);
  assert.match(
    plan.prompt.systemMessage,
    /Do not include internal verifier metadata or fields outside the JSON structure/u
  );
  assert.doesNotMatch(plan.prompt.systemMessage, /unless it is explicitly needed/u);
  assert.match(plan.prompt.userMessage, /expectedBehavior/);
  assert.match(plan.prompt.userMessage, /actualBehavior/);
  assert.match(plan.prompt.userMessage, /sourceHypothesisId/);
  assert.doesNotMatch(plan.prompt.userMessage, /supportingEvidence/);
  assert.doesNotMatch(plan.prompt.userMessage, /guardsChecked/);
  assert.doesNotMatch(plan.prompt.userMessage, /uncertaintyStatus/);
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

test("Step6CognitiveSimulationStep includes full candidate findings JSON in review_state snapshot", () => {
  const candidate = createFinding("F1");
  const step = new Step6CognitiveSimulationStep({ promptSerializer: serializer });
  const plan = step.prepare(createContext([candidate]));

  const snapshot = parseReviewStateFromPrompt(plan.prompt.userMessage) as {
    candidateFindings: Finding[];
    verifiedFindings: Finding[];
  };

  assert.deepEqual(snapshot.candidateFindings, [candidate]);
  assert.deepEqual(snapshot.verifiedFindings, []);
  assert.equal(plan.prompt.userMessage.includes("<candidate_findings"), false);
  assert.match(plan.prompt.userMessage, /findingUpdates/);
  assert.match(
    plan.prompt.systemMessage,
    /Do not include internal verifier metadata or fields outside the JSON structure/u
  );
  assert.doesNotMatch(plan.prompt.systemMessage, /unless it is explicitly needed/u);
  assert.doesNotMatch(plan.prompt.userMessage, /supportingEvidence/);
  assert.doesNotMatch(plan.prompt.userMessage, /uncertaintyStatus/);
  assert.doesNotMatch(plan.prompt.userMessage, /verifierVerdict/);
  assert.match(
    plan.prompt.userMessage,
    /If no findings remain, return: \{"schemaVersion": 2, "findingUpdates": \[\], "dispositions":/u
  );
  assert.match(plan.prompt.userMessage, /Retained candidates MUST NOT appear in the `findingUpdates` array/u);
  assert.match(plan.prompt.userMessage, /SUPPORTED.*ANCHOR.*EVIDENCE.*REACHABILITY.*OUT_OF_SCOPE.*DUPLICATE.*CONTRADICTION/);
});
