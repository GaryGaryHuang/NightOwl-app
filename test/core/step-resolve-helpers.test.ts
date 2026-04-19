import test from "node:test";
import assert from "node:assert/strict";

import { FileReviewContext, type Finding, type FindingDisposition } from "../../src/core/file-review-context.ts";
import { StructuredOutputValidator } from "../../src/core/structured-output-validator.ts";
import { createStep6DispositionResolve } from "../../src/core/steps/step-resolve-helpers.ts";
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
            finding({
              findingId: "F1",
              uncertaintyStatus: "tentative"
            })
          ],
          [disposition({ findingId: "F1", status: "retained" })]
        ),
        createResolveServices()
      ),
    /retained.*F1.*must appear in findings/u
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
      [finding({ findingId: "F1" })],
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
      [finding({ findingId: "F2" })],
      [disposition({ findingId: "F1", status: "retired" })]
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
  return JSON.stringify({ findings, dispositions });
}

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    type: "must",
    title: "Step 6 finding",
    traceability: { kind: "line-range", lineStart: 1, lineEnd: 1 },
    context: "context",
    deviation: "deviation",
    impact: "impact",
    suggestion: "suggestion",
    confidence: 90,
    findingId: "F1",
    supportingEvidence: [{ source: "diff:src/app.ts:1", content: "value changed" }],
    reachability: { credible: true, description: "reachable" },
    uncertaintyStatus: "supported",
    ...overrides
  };
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