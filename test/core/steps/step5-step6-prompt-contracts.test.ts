import assert from "node:assert/strict";
import test from "node:test";

import { FileReviewContext, type Finding } from "../../../src/core/file-review-context.ts";
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
    findingId,
    supportingEvidence: [
      { evidenceRef: "E1", supports: "expectedBehavior" },
      { evidenceRef: "E2", supports: "actualBehavior" },
      { evidenceRef: "E3", supports: "reachability" },
      { evidenceRef: "E4", supports: "impact" }
    ],
    reachability: {
      credible: true,
      entryPoint: "main entry",
      guardsChecked: ["guard"],
      description: "reachable"
    },
    uncertaintyStatus: "supported"
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

  assert.match(plan.prompt.userMessage, /expectedBehavior/);
  assert.match(plan.prompt.userMessage, /actualBehavior/);
  assert.match(plan.prompt.userMessage, /guardsChecked/);
});

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
  assert.match(plan.prompt.userMessage, /supportingEvidence/);
  assert.match(plan.prompt.userMessage, /reachability/);
  assert.match(plan.prompt.userMessage, /uncertaintyStatus/);
  assert.match(plan.prompt.userMessage, /verifierVerdict/);
  assert.match(
    plan.prompt.userMessage,
    /If no findings remain, return: \{"schemaVersion": 2, "findings": \[\], "dispositions":/u
  );
  assert.match(plan.prompt.userMessage, /SUPPORTED.*ANCHOR.*EVIDENCE.*REACHABILITY.*OUT_OF_SCOPE.*DUPLICATE.*CONTRADICTION/);
});
