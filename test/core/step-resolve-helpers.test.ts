import test from "node:test";
import assert from "node:assert/strict";

import { FileReviewContext, type Finding, type FindingDisposition } from "../../src/core/file-review-context.ts";
import { StructuredOutputValidator } from "../../src/core/structured-output-validator.ts";
import {
  createStructuredResolve,
  createStep6DispositionResolve
} from "../../src/core/steps/step-resolve-helpers.ts";
import type { StepResolveServices } from "../../src/core/step-runner.ts";

const DEFAULT_CONTEXT = {
  filePath: "src/app.ts",
  noteFilePath: "/tmp/src__app.ts.md",
  diffContent: "@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n",
  baseRef: "main",
  headRef: "feature"
} as const;

test("createStep6DispositionResolve rejects retained candidates removed by acceptance filtering", async () => {
  const resolve = createStep6DispositionResolve({
    filePath: DEFAULT_CONTEXT.filePath,
    diffContent: DEFAULT_CONTEXT.diffContent,
    candidateFindingIds: ["F1"]
  });

  await assert.rejects(
    () =>
      resolve(
        verifiedPayload(
          [
            verifiedFinding({
              findingId: "F1",
              uncertaintyStatus: "tentative"
            })
          ],
          [disposition({ findingId: "F1", status: "retained" })]
        ),
        createResolveServices()
      ),
    /must be accepted.*uncertaintyStatus/u
  );
});

test("createStructuredResolve writes accepted findings and verifier report entries", async () => {
  const context = createContext();
  const resolve = createStructuredResolve({
    filePath: DEFAULT_CONTEXT.filePath,
    diffContent: DEFAULT_CONTEXT.diffContent
  });

  const applyTo = await resolve(
    JSON.stringify({
      schemaVersion: 2,
      findings: [
        finding({ findingId: "F1" }),
        finding({
          findingId: "F2",
          uncertaintyStatus: "tentative"
        })
      ]
    }),
    createResolveServices()
  );

  applyTo(context);

  assert.deepEqual(
    context.getFindings()?.map((f) => f.findingId),
    ["F1"]
  );
  assert.deepEqual(
    context.getVerifierReportEntries()?.map((entry) => ({
      stepId: entry.stepId,
      findingId: entry.findingId,
      taxonomy: entry.taxonomy,
      outcome: entry.outcome,
      gate: entry.gate
    })),
    [
      {
        stepId: "step5-validation-interrogation",
        findingId: "F1",
        taxonomy: "OK",
        outcome: "accepted",
        gate: "schema"
      },
      {
        stepId: "step5-validation-interrogation",
        findingId: "F2",
        taxonomy: "OK",
        outcome: "accepted",
        gate: "schema"
      },
      {
        stepId: "step5-validation-interrogation",
        findingId: "F1",
        taxonomy: "OK",
        outcome: "accepted",
        gate: "acceptance"
      },
      {
        stepId: "step5-validation-interrogation",
        findingId: "F2",
        taxonomy: "EVIDENCE",
        outcome: "rejected",
        gate: "acceptance"
      }
    ]
  );
});

test("createStep6DispositionResolve writes accepted findings and matching dispositions", async () => {
  const context = createContext();
  const resolve = createStep6DispositionResolve({
    filePath: DEFAULT_CONTEXT.filePath,
    diffContent: DEFAULT_CONTEXT.diffContent,
    candidateFindingIds: ["F1"]
  });

  const applyTo = await resolve(
    verifiedPayload(
      [verifiedFinding({ findingId: "F1" })],
      [disposition({ findingId: "F1", status: "retained" })]
    ),
    createResolveServices()
  );

  applyTo(context);

  assert.deepEqual(
    context.getFindings()?.map((f) => f.findingId),
    ["F1"]
  );
  assert.deepEqual(
    context.getDispositions()?.map((d) => ({ findingId: d.findingId, status: d.status })),
    [{ findingId: "F1", status: "retained" }]
  );
  assert.deepEqual(
    context.getVerifierReportEntries()?.map((entry) => ({
      stepId: entry.stepId,
      findingId: entry.findingId,
      taxonomy: entry.taxonomy,
      outcome: entry.outcome,
      gate: entry.gate
    })),
    [
      {
        stepId: "step6-cognitive-simulation",
        findingId: "F1",
        taxonomy: "OK",
        outcome: "accepted",
        gate: "schema"
      },
      {
        stepId: "step6-cognitive-simulation",
        findingId: "F1",
        taxonomy: "OK",
        outcome: "accepted",
        gate: "acceptance"
      }
    ]
  );
});

test("createStep6DispositionResolve allows new accepted findings without dispositions", async () => {
  const context = createContext();
  const resolve = createStep6DispositionResolve({
    filePath: DEFAULT_CONTEXT.filePath,
    diffContent: DEFAULT_CONTEXT.diffContent,
    candidateFindingIds: ["F1"]
  });

  const applyTo = await resolve(
    verifiedPayload(
      [verifiedFinding({ findingId: "F2" })],
      [disposition({ findingId: "F1", status: "retired", reason: "REACHABILITY" })]
    ),
    createResolveServices()
  );

  applyTo(context);

  assert.deepEqual(
    context.getFindings()?.map((f) => f.findingId),
    ["F2"]
  );
  assert.deepEqual(
    context.getDispositions()?.map((d) => ({ findingId: d.findingId, status: d.status })),
    [{ findingId: "F1", status: "retired" }]
  );
  assert.deepEqual(
    context.getVerifierReportEntries()?.map((entry) => entry.findingId),
    ["F2", "F2", "F1"]
  );
  assert.deepEqual(
    context.getVerifierReportEntries()?.at(-1),
    {
      filePath: DEFAULT_CONTEXT.filePath,
      stepId: "step6-cognitive-simulation",
      findingId: "F1",
      taxonomy: "REACHABILITY",
      outcome: "rejected",
      gate: "disposition",
      reason: "candidate retired: REACHABILITY - simulation confirms",
      dispositionStatus: "retired",
      dispositionReason: "REACHABILITY",
      dispositionExplanation: "simulation confirms"
    }
  );
});

test("createStep6DispositionResolve appends Step 6 verifier entries after existing Step 5 entries", async () => {
  const context = createContext();
  context.appendVerifierReportEntries([
    {
      filePath: DEFAULT_CONTEXT.filePath,
      stepId: "step5-validation-interrogation",
      findingId: "F0",
      taxonomy: "OK",
      outcome: "accepted",
      gate: "acceptance",
      reason: "passed all acceptance gates"
    }
  ]);
  const resolve = createStep6DispositionResolve({
    filePath: DEFAULT_CONTEXT.filePath,
    diffContent: DEFAULT_CONTEXT.diffContent,
    candidateFindingIds: ["F1"]
  });

  const applyTo = await resolve(
    verifiedPayload(
      [verifiedFinding({ findingId: "F1" })],
      [disposition({ findingId: "F1", status: "retained" })]
    ),
    createResolveServices()
  );

  applyTo(context);

  assert.deepEqual(
    context.getVerifierReportEntries()?.map((entry) => entry.stepId),
    [
      "step5-validation-interrogation",
      "step6-cognitive-simulation",
      "step6-cognitive-simulation"
    ]
  );
});

function createContext(): FileReviewContext {
  return new FileReviewContext({ ...DEFAULT_CONTEXT });
}

function createResolveServices(): StepResolveServices {
  return {
    validator: new StructuredOutputValidator()
  };
}

function verifiedPayload(findings: Finding[], dispositions: FindingDisposition[]): string {
  return JSON.stringify({ schemaVersion: 2, findings, dispositions });
}

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    type: "must",
    title: "Step 6 finding",
    traceability: { kind: "line-range", lineStart: 1, lineEnd: 1 },
    expectedBehavior: "expected behavior",
    actualBehavior: "actual behavior",
    deviation: "deviation",
    impact: "impact",
    suggestion: "suggestion",
    findingId: "F1",
    supportingEvidence: [
      { evidenceRef: "E1", supports: "expectedBehavior" },
      { evidenceRef: "E2", supports: "actualBehavior" },
      { evidenceRef: "E3", supports: "reachability" },
      { evidenceRef: "E4", supports: "impact" }
    ],
    reachability: {
      credible: true,
      entryPoint: "handleRequest",
      guardsChecked: ["guard checked"]
    },
    uncertaintyStatus: "supported",
    ...overrides
  };
}

function verifiedFinding(overrides: Partial<Finding> = {}): Finding {
  return finding({
    verifierVerdict: {
      status: "accepted",
      checks: {
        anchor: "pass",
        evidence: "pass",
        reachability: "pass",
        impact: "pass",
        scope: "pass",
        duplicate: "pass"
      }
    },
    ...overrides
  });
}

function disposition(
  overrides: Partial<FindingDisposition> = {}
): FindingDisposition {
  return {
    findingId: "F1",
    status: "retained",
    reason: "SUPPORTED",
    explanation: "simulation confirms",
    ...overrides
  };
}
