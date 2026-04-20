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
    context: "ctx",
    deviation: "dev",
    impact: "impact",
    suggestion: "suggestion",
    modelConfidence: 42,
    findingId,
    supportingEvidence: [{ source: "diff:src/app.ts:1", content: "changed" }],
    reachability: { credible: true, description: "reachable" },
    uncertaintyStatus: "supported"
  };
}

const serializer = new ReviewStatePromptSerializer();

test("Step5ValidationInterrogationStep prompt contract requests modelConfidence", () => {
  const step = new Step5ValidationInterrogationStep({ promptSerializer: serializer });
  const plan = step.prepare(createContext());

  assert.match(plan.prompt.userMessage, /modelConfidence/);
  assert.equal(plan.prompt.userMessage.includes('"confidence"'), false);
});

test("Step6CognitiveSimulationStep includes full candidate findings JSON in candidate_findings block", () => {
  const candidate = createFinding("F1");
  const step = new Step6CognitiveSimulationStep({ promptSerializer: serializer });
  const plan = step.prepare(createContext([candidate]));

  const match = plan.prompt.userMessage.match(
    /<candidate_findings format="json">\n([\s\S]*?)\n<\/candidate_findings>/
  );

  assert.ok(match, "candidate_findings block should be present");
  const parsed = JSON.parse(match[1]);
  assert.deepEqual(parsed, [candidate]);
  assert.match(plan.prompt.userMessage, /modelConfidence/);
  assert.match(plan.prompt.userMessage, /supportingEvidence/);
  assert.match(plan.prompt.userMessage, /reachability/);
  assert.match(plan.prompt.userMessage, /uncertaintyStatus/);
});