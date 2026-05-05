import assert from "node:assert/strict";
import { describe, before, test } from "node:test";

import { ReviewOrchestrator, type ReviewRunSummary } from "../../src/core/orchestrator.ts";
import type { RunProgressEvent } from "../../src/core/run-progress.ts";
import { createRunContext } from "../../src/core/run-context.ts";
import { stubChangeMap } from "../helpers/change-map-stub.ts";
import { defineOutputSinkDouble } from "../helpers/output-sink-double.ts";
import {
  buildReviewBasis,
  buildSuccessfulStepResult
} from "../helpers/orchestrator-fixture.ts";
import type { StepResult } from "../../src/core/step-runner.ts";
import type { FileReviewContext, Finding } from "../../src/core/file-review-context.ts";

/**
 * Progress event contract tests owned at the orchestrator layer.
 *
 * Drives ReviewOrchestrator end-to-end with injected doubles over a
 * deterministic two-file scenario:
 *  - src/app.ts          → all steps succeed
 *  - packages/app/index.ts → skipped at ReviewBasis due to a thrown step failure
 *
 * maxConcurrentFiles is set to 1 so files are processed sequentially,
 * giving the event sequence a deterministic total order.
 */
describe("ReviewOrchestrator progress events", () => {
  let result: ReviewRunSummary;
  const events: string[] = [];

  before(async () => {
    const orchestrator = new ReviewOrchestrator({
      workingDirectory: "/workspace/repo",
      timestampProvider: () => "03131430",
      maxConcurrentFiles: 1,
      sourceProvider: {
        async resolveRepoRoot() {
          return "/workspace/repo";
        },
        async getChangesetEntries() {
          return [
            { status: "M" as const, path: "src/app.ts" },
            { status: "M" as const, path: "packages/app/index.ts" }
          ];
        },
        async getCurrentBranch() {
          return "feature-branch";
        },
        async getChangedFiles() {
          return ["src/app.ts", "packages/app/index.ts"];
        },
        async getDiff(_repoRoot, _baseRef, _headRef, filePath) {
          return `--- a/${filePath}\n+++ b/${filePath}\n@@ -1 +1 @@\n-old\n+new\n`;
        }
      },
      reviewFileFilter: {
        async filterReviewableFiles(_repoRoot: string, files: string[]) {
          return files;
        }
      },
      changesetOverviewRunner: {
        async run() {
          return createRunContext({
            changesetOverview: stubChangeMap("## Changeset Overview\n- 調整範圍：feature"),
            userContext: []
          });
        }
      },
      outputSink: defineOutputSinkDouble({
        async initializeRun() {
          return this;
        },
        async publishFileReview() {},
        async publishSkippedFile() {},
        async publishArtifact() {}
      }),
      stepRunner: {
        async run({ step, context }) {
          // Deterministic skip: packages/app/index.ts fails at ReviewBasis.
          // The orchestrator does not retry at this level; it catches and skips.
          if (
            context.filePath === "packages/app/index.ts" &&
            step.stepId === "review-basis"
          ) {
            throw new Error("deterministic validation failed");
          }

          return buildSuccessfulStepResult(step.stepId, context.filePath);
        }
      },
      onProgressEvent(event) {
        events.push(renderProgressEvent(event));
      }
    });

    result = await orchestrator.run({
      baseRef: "main",
      headRef: "feature-branch",
      repoPath: ".",
      userContext: [],
      dryRun: false
    });
  });

  test("run summary counts one success and one skip", () => {
    assert.equal(result.plannedFileCount, 2);
    assert.equal(result.successfulFileCount, 1);
    assert.equal(result.skippedFileCount, 1);
  });

  test("event sequence covers all phases, per-file steps, skip, and finalize", () => {
    assert.deepEqual(events, [
      "phase:step0",
      "phase:planning",
      "initialized:2:/workspace/repo/.nightowl/review/feature-branch_03131430",
      "phase:reviewing",
      "claimed:1:src/app.ts",
      "progress:src/app.ts:review-basis",
      "progress:src/app.ts:step5-validation-interrogation",
      "progress:src/app.ts:step6-cognitive-simulation",
      "progress:src/app.ts:step7-summary",
      "completed:src/app.ts",
      "claimed:2:packages/app/index.ts",
      "skipped:packages/app/index.ts:review-basis:deterministic validation failed",
      "finalizing:2:1:1"
    ]);
  });
});

test("ReviewOrchestrator caps semantic Step 5/6 reruns at two before continuing to Step 7", async () => {
  const events: string[] = [];
  const stepEvents: string[] = [];
  let step5Attempt = 0;
  let step7LoopAction: string | undefined;
  let step7MissingInformationIds: string[] = [];
  const orchestrator = new ReviewOrchestrator({
    workingDirectory: "/workspace/repo",
    timestampProvider: () => "03131431",
    maxConcurrentFiles: 1,
    sourceProvider: createOneFileSourceProvider(),
    reviewFileFilter: {
      async filterReviewableFiles(_repoRoot: string, files: string[]) {
        return files;
      }
    },
    changesetOverviewRunner: {
      async run() {
        return createRunContext({
          changesetOverview: stubChangeMap("## Changeset Overview\n- 調整範圍：feature"),
          userContext: []
        });
      }
    },
    outputSink: defineOutputSinkDouble({
      async initializeRun() {
        return this;
      },
      async publishFileReview() {},
      async publishSkippedFile() {},
      async publishArtifact() {}
    }),
    stepRunner: {
      async run({ step, context }) {
        stepEvents.push(step.stepId);
        if (step.stepId === "step5-validation-interrogation") {
          step5Attempt += 1;
        }
        if (step.stepId === "step7-summary") {
          step7LoopAction = context.getValidationReportV1()?.loopControl.action;
          step7MissingInformationIds =
            context.getValidationReportV1()?.missingInformationItems.map((item) => item.itemId) ?? [];
        }
        return buildSemanticLoopStepResult(step.stepId, context.filePath, {
          candidateVariant: step5Attempt
        });
      }
    },
    onProgressEvent(event) {
      events.push(renderProgressEvent(event));
    }
  });

  const result = await orchestrator.run({
    baseRef: "main",
    headRef: "feature-branch",
    repoPath: ".",
    userContext: [],
    dryRun: false
  });

  assert.equal(result.successfulFileCount, 1);
  assert.deepEqual(stepEvents, [
    "review-basis",
    "step5-validation-interrogation",
    "step6-cognitive-simulation",
    "step5-validation-interrogation",
    "step6-cognitive-simulation",
    "step5-validation-interrogation",
    "step6-cognitive-simulation",
    "step7-summary"
  ]);
  assert.deepEqual(
    events.filter((event) => event.startsWith("progress:src/app.ts")),
    [
      "progress:src/app.ts:review-basis",
      "progress:src/app.ts:step5-validation-interrogation",
      "progress:src/app.ts:step6-cognitive-simulation",
      "progress:src/app.ts:step5-validation-interrogation",
      "progress:src/app.ts:step6-cognitive-simulation",
      "progress:src/app.ts:step5-validation-interrogation",
      "progress:src/app.ts:step6-cognitive-simulation",
      "progress:src/app.ts:step7-summary"
    ]
  );
  assert.equal(step7LoopAction, "accept");
  assert.deepEqual(step7MissingInformationIds, ["MI-semantic-3"]);
});

test("ReviewOrchestrator stops repeated unsupported semantic claims without spending all reruns", async () => {
  const stepEvents: string[] = [];
  let step7LoopAction: string | undefined;
  let step7MissingInformationIds: string[] = [];
  const orchestrator = new ReviewOrchestrator({
    workingDirectory: "/workspace/repo",
    timestampProvider: () => "03131432",
    maxConcurrentFiles: 1,
    sourceProvider: createOneFileSourceProvider(),
    reviewFileFilter: {
      async filterReviewableFiles(_repoRoot: string, files: string[]) {
        return files;
      }
    },
    changesetOverviewRunner: {
      async run() {
        return createRunContext({
          changesetOverview: stubChangeMap("## Changeset Overview\n- 調整範圍：feature"),
          userContext: []
        });
      }
    },
    outputSink: defineOutputSinkDouble({
      async initializeRun() {
        return this;
      },
      async publishFileReview() {},
      async publishSkippedFile() {},
      async publishArtifact() {}
    }),
    stepRunner: {
      async run({ step, context }) {
        stepEvents.push(step.stepId);
        if (step.stepId === "step7-summary") {
          step7LoopAction = context.getValidationReportV1()?.loopControl.action;
          step7MissingInformationIds =
            context.getValidationReportV1()?.missingInformationItems.map((item) => item.itemId) ?? [];
        }
        return buildSemanticLoopStepResult(step.stepId, context.filePath, {
          candidateVariant: 1
        });
      }
    }
  });

  const result = await orchestrator.run({
    baseRef: "main",
    headRef: "feature-branch",
    repoPath: ".",
    userContext: [],
    dryRun: false
  });

  assert.equal(result.successfulFileCount, 1);
  assert.deepEqual(stepEvents, [
    "review-basis",
    "step5-validation-interrogation",
    "step6-cognitive-simulation",
    "step5-validation-interrogation",
    "step6-cognitive-simulation",
    "step7-summary"
  ]);
  assert.equal(step7LoopAction, "accept");
  assert.deepEqual(step7MissingInformationIds, ["MI-semantic-repeated-2"]);
});

test("ReviewOrchestrator honors Step 6 missing-critical-contract stop without semantic rerun", async () => {
  const stepEvents: string[] = [];
  let step7MissingInformationIds: string[] = [];
  const orchestrator = new ReviewOrchestrator({
    workingDirectory: "/workspace/repo",
    timestampProvider: () => "03131433",
    maxConcurrentFiles: 1,
    sourceProvider: createOneFileSourceProvider(),
    reviewFileFilter: {
      async filterReviewableFiles(_repoRoot: string, files: string[]) {
        return files;
      }
    },
    changesetOverviewRunner: {
      async run() {
        return createRunContext({
          changesetOverview: stubChangeMap("## Changeset Overview\n- 調整範圍：feature"),
          userContext: []
        });
      }
    },
    outputSink: defineOutputSinkDouble({
      async initializeRun() {
        return this;
      },
      async publishFileReview() {},
      async publishSkippedFile() {},
      async publishArtifact() {}
    }),
    stepRunner: {
      async run({ step, context }) {
        stepEvents.push(step.stepId);
        if (step.stepId === "step7-summary") {
          step7MissingInformationIds =
            context.getValidationReportV1()?.missingInformationItems.map((item) => item.itemId) ?? [];
        }
        return buildSemanticLoopStepResult(step.stepId, context.filePath, {
          validationMode: "missing-critical-stop"
        });
      }
    }
  });

  const result = await orchestrator.run({
    baseRef: "main",
    headRef: "feature-branch",
    repoPath: ".",
    userContext: [],
    dryRun: false
  });

  assert.equal(result.successfulFileCount, 1);
  assert.deepEqual(stepEvents, [
    "review-basis",
    "step5-validation-interrogation",
    "step6-cognitive-simulation",
    "step7-summary"
  ]);
  assert.deepEqual(step7MissingInformationIds, ["MI1"]);
});

/**
 * Serializes a RunProgressEvent to a compact string for use in deepEqual assertions.
 * The switch is exhaustive over RunProgressEvent — TypeScript will flag a compile error
 * if a new event type is added without a corresponding case here.
 */
function renderProgressEvent(event: RunProgressEvent): string {
  switch (event.type) {
    case "phase-changed":
      return `phase:${event.phase}`;
    case "run-initialized":
      return `initialized:${event.plannedFileCount}:${event.outputTarget.basePath}`;
    case "file-claimed":
      return `claimed:${event.claimOrder}:${event.filePath}`;
    case "file-progressed":
      return `progress:${event.filePath}:${event.stepId}`;
    case "file-completed":
      return `completed:${event.filePath}`;
    case "file-skipped":
      return `skipped:${event.filePath}:${event.stepId}:${event.reason}`;
    case "run-finalizing":
      return `finalizing:${event.plannedFileCount}:${event.successfulFileCount}:${event.skippedFileCount}`;
    case "finalizer-failed":
      return `finalizer-failed:${event.artifact}:${event.message}`;
    case "tool-audit-write-failed":
      return `tool-audit-write-failed:${event.message}`;
    case "review-session-log":
      return `review-session-log:${event.stepId}:${event.message}`;
  }
}

function createOneFileSourceProvider() {
  return {
    async resolveRepoRoot() {
      return "/workspace/repo";
    },
    async getChangesetEntries() {
      return [{ status: "M" as const, path: "src/app.ts" }];
    },
    async getCurrentBranch() {
      return "feature-branch";
    },
    async getChangedFiles() {
      return ["src/app.ts"];
    },
    async getDiff(_repoRoot: string, _baseRef: string, _headRef: string, filePath: string) {
      return `--- a/${filePath}\n+++ b/${filePath}\n@@ -1 +1 @@\n-old\n+new\n`;
    }
  };
}

function buildSemanticLoopStepResult(
  stepId: string,
  filePath: string,
  options: {
    candidateVariant?: number;
    validationMode?: "rerun" | "missing-critical-stop";
  } = {}
): StepResult {
  if (stepId === "review-basis") {
    return {
      stepId,
      applyTo(context: FileReviewContext) {
        context.setReviewBasis(buildReviewBasis(filePath));
      }
    };
  }

  if (stepId === "step5-validation-interrogation") {
    return {
      stepId,
      applyTo(context: FileReviewContext) {
        (context as SemanticFileReviewContext).setCandidateFindingsV3(
          createCandidateFindingsV3(options.candidateVariant ?? 1)
        );
      }
    };
  }

  if (stepId === "step6-cognitive-simulation") {
    return {
      stepId,
      applyTo(context: FileReviewContext) {
        const report = options.validationMode === "missing-critical-stop"
          ? createStopValidationReportV1()
          : createRerunValidationReportV1();
        (context as SemanticFileReviewContext).setValidationReportV1(report);
        if (options.validationMode === "missing-critical-stop") {
          context.setMissingInformationItems(report.missingInformationItems);
          context.setFindings(report.approvedFindings);
        }
      }
    };
  }

  if (stepId === "step7-summary") {
    return {
      stepId,
      applyTo(context: FileReviewContext) {
        context.setSection("summary", "## Summary\n### 審查基礎\n- 改動概要：無\n- 依據規範：無\n- 必要假設：無\n### 行為變更提醒\n- 無行為變更\n### 風險評估\n- 整體風險等級：None\n- 風險理由：no approved findings");
      }
    };
  }

  throw new Error(`Unexpected step ${stepId}`);
}

type SemanticFileReviewContext = FileReviewContext & {
  setCandidateFindingsV3(payload: ReturnType<typeof createCandidateFindingsV3>): void;
  setValidationReportV1(
    report:
      | ReturnType<typeof createRerunValidationReportV1>
      | ReturnType<typeof createStopValidationReportV1>
  ): void;
};

function createCandidateFindingsV3(variant: number) {
  return {
    result: "FINDINGS_READY",
    findings: [
      {
        findingId: "F1",
        sourceHypothesisIds: ["H1"],
        classification: "confirmed_problem",
        priority: "must",
        severity: "high",
        confidence: "high",
        evidenceStrength: "direct",
        title: `unsupported claim ${variant}`,
        traceability: { kind: "line-range" as const, lineStart: 1, lineEnd: 1 },
        codeEvidence: [
          {
            evidenceId: "E1",
            location: "src/app.ts:1",
            summary: "candidate evidence"
          }
        ],
        executionPath: ["entry", "changed branch"],
        triggerCondition: `candidate trigger ${variant}`,
        failureMechanism: "candidate mechanism",
        impact: "candidate impact",
        counterEvidenceChecked: ["candidate counter-evidence"],
        fixDirection: "candidate fix",
        testRecommendation: "candidate test"
      }
    ],
    hypothesisClosure: [
      {
        hypothesisId: "H1",
        status: "closed_by_candidate",
        evidenceIds: ["E1"],
        rationale: "candidate closes H1"
      }
    ],
    criticalMissingInformation: []
  };
}

function createRerunValidationReportV1() {
  return {
    perFindingResults: [
      {
        findingId: "F1",
        decision: "rewrite_required",
        failedGates: ["impact"],
        requiredCorrections: ["Prove impact or convert to missing information."],
        reason: "impact is unsupported"
      }
    ],
    approvedFindings: [] as Finding[],
    missingInformationItems: [],
    loopControl: {
      action: "rerun_step5",
      reason: "Step 5 must repair machine-actionable evidence gaps"
    }
  };
}

function createStopValidationReportV1() {
  return {
    perFindingResults: [
      {
        findingId: "F1",
        decision: "drop",
        failedGates: ["completeness"],
        requiredCorrections: ["Attach the external null-input contract before approving a finding."],
        reason: "approval is blocked by a missing critical contract"
      }
    ],
    approvedFindings: [] as Finding[],
    missingInformationItems: [
      {
        itemId: "MI1",
        description: "Need the external null-input contract before approving the candidate.",
        whyItMatters: "Without the contract, Step 6 cannot distinguish a real defect from unsupported speculation."
      }
    ],
    loopControl: {
      action: "accept",
      reason: "missing critical contract"
    }
  };
}
