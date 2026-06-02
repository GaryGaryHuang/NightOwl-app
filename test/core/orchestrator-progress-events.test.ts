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
import type { FileReviewContext } from "../../src/core/file-review-context.ts";

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
      "phase:changeset-overview",
      "phase:planning",
      "initialized:2:/workspace/repo/.nightowl/review/feature-branch_03131430",
      "phase:reviewing",
      "claimed:1:src/app.ts",
      "progress:src/app.ts:review-basis",
      "progress:src/app.ts:candidate-findings",
      "progress:src/app.ts:semantic-validation",
      "progress:src/app.ts:review-summary",
      "completed:src/app.ts",
      "claimed:2:packages/app/index.ts",
      "skipped:packages/app/index.ts:review-basis:deterministic validation failed",
      "finalizing:2:1:1"
    ]);
  });
});

test("ReviewOrchestrator caps semantic Candidate Findings reruns at two before continuing to Review Summary", async () => {
  const events: string[] = [];
  const stepEvents: string[] = [];
  let candidateFindingsAttempt = 0;
  let reviewSummaryLoopAction: string | undefined;
  let reviewSummaryMissingInformationIds: string[] = [];
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
      async publishArtifact() {}
    }),
    stepRunner: {
      async run({ step, context }) {
        stepEvents.push(step.stepId);
        if (step.stepId === "candidate-findings") {
          candidateFindingsAttempt += 1;
        }
        if (step.stepId === "review-summary") {
          reviewSummaryLoopAction = context.getValidationReportV1()?.loopControl.action;
          reviewSummaryMissingInformationIds =
            context.getValidationReportV1()?.missingInformationItems.map((item) => item.itemId) ?? [];
        }
        return buildSemanticLoopStepResult(step.stepId, context.filePath, {
          candidateVariant: candidateFindingsAttempt
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
    "candidate-findings",
    "semantic-validation",
    "candidate-findings",
    "semantic-validation",
    "candidate-findings",
    "semantic-validation",
    "review-summary"
  ]);
  assert.deepEqual(
    events.filter((event) => event.startsWith("progress:src/app.ts")),
    [
      "progress:src/app.ts:review-basis",
      "progress:src/app.ts:candidate-findings",
      "progress:src/app.ts:semantic-validation",
      "progress:src/app.ts:candidate-findings",
      "progress:src/app.ts:semantic-validation",
      "progress:src/app.ts:candidate-findings",
      "progress:src/app.ts:semantic-validation",
      "progress:src/app.ts:review-summary"
    ]
  );
  assert.equal(reviewSummaryLoopAction, "accept");
  assert.deepEqual(reviewSummaryMissingInformationIds, []);
});

test("ReviewOrchestrator accumulates approved candidates while rerunning only active rewrites", async () => {
  const stepEvents: string[] = [];
  let candidateFindingsAttempt = 0;
  let semanticValidationAttempt = 0;
  let reviewSummaryFindingTitles: string[] = [];
  let reviewSummaryDecisions: string[] = [];
  const orchestrator = new ReviewOrchestrator({
    workingDirectory: "/workspace/repo",
    timestampProvider: () => "03131437",
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
      async publishArtifact() {}
    }),
    stepRunner: {
      async run({ step, context }) {
        stepEvents.push(step.stepId);
        if (step.stepId === "review-basis") {
          return {
            stepId: step.stepId,
            applyTo(targetContext: FileReviewContext) {
              targetContext.setReviewBasis(buildReviewBasis(targetContext.filePath));
            }
          };
        }

        if (step.stepId === "candidate-findings") {
          candidateFindingsAttempt += 1;
          if (candidateFindingsAttempt === 2) {
            assert.equal(context.getFindings(), undefined);
            assert.deepEqual(
              context.getAccumulatedApprovedFindings().map((finding) => finding.title),
              ["already proven candidate"]
            );
            assert.deepEqual(
              context.getCandidateFindings()?.findings.map((finding) => [
                finding.findingId,
                finding.title
              ]),
              [["F1", "candidate needing repair"]]
            );
          }
          return {
            stepId: step.stepId,
            applyTo(targetContext: FileReviewContext) {
              (targetContext as SemanticFileReviewContext).setCandidateFindings(
                candidateFindingsAttempt === 1
                  ? createMixedCandidateFindings()
                  : createRepairedCandidateFindings()
              );
            }
          };
        }

        if (step.stepId === "semantic-validation") {
          semanticValidationAttempt += 1;
          return {
            stepId: step.stepId,
            applyTo(targetContext: FileReviewContext) {
              (targetContext as SemanticFileReviewContext).setValidationReportV1(
                semanticValidationAttempt === 1
                  ? createMixedRerunValidationReportV1()
                  : createAcceptValidationReportV1()
              );
            }
          };
        }

        if (step.stepId === "review-summary") {
          reviewSummaryFindingTitles =
            context.getFindings()?.map((finding) => finding.title) ?? [];
          reviewSummaryDecisions =
            context.getValidationReportV1()?.perFindingResults.map(
              (result) => result.decision
            ) ?? [];
          return {
            stepId: step.stepId,
            applyTo(targetContext: FileReviewContext) {
              targetContext.setSection("summary", "## Summary\n### 審查結論\n- 已驗證的結果：must-fix 2；nice-to-have 0\n- 審查限制：無\n\n### 審查依據\n- 異動概要：無\n- 已核對依據：無\n- 待確認資訊：無\n### 行為變更提醒\n- 無行為變更");
            }
          };
        }

        throw new Error(`Unexpected step ${step.stepId}`);
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
    "candidate-findings",
    "semantic-validation",
    "candidate-findings",
    "semantic-validation",
    "review-summary"
  ]);
  assert.deepEqual(reviewSummaryFindingTitles, [
    "already proven candidate",
    "repaired candidate"
  ]);
  assert.deepEqual(reviewSummaryDecisions, ["approve", "approve"]);
});

test("ReviewOrchestrator stops repeated unsupported semantic claims without spending all reruns", async () => {
  const stepEvents: string[] = [];
  let reviewSummaryLoopAction: string | undefined;
  let reviewSummaryMissingInformationIds: string[] = [];
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
      async publishArtifact() {}
    }),
    stepRunner: {
      async run({ step, context }) {
        stepEvents.push(step.stepId);
        if (step.stepId === "review-summary") {
          reviewSummaryLoopAction = context.getValidationReportV1()?.loopControl.action;
          reviewSummaryMissingInformationIds =
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
    "candidate-findings",
    "semantic-validation",
    "candidate-findings",
    "semantic-validation",
    "review-summary"
  ]);
  assert.equal(reviewSummaryLoopAction, "accept");
  assert.deepEqual(reviewSummaryMissingInformationIds, []);
});

test("ReviewOrchestrator does not stop semantic rerun when Candidate Findings changes only evidence", async () => {
  const stepEvents: string[] = [];
  let candidateFindingsAttempt = 0;
  const orchestrator = new ReviewOrchestrator({
    workingDirectory: "/workspace/repo",
    timestampProvider: () => "03131434",
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
      async publishArtifact() {}
    }),
    stepRunner: {
      async run({ step, context }) {
        stepEvents.push(step.stepId);
        if (step.stepId === "candidate-findings") {
          candidateFindingsAttempt += 1;
        }
        return buildSemanticLoopStepResult(step.stepId, context.filePath, {
          candidateVariant: 1,
          candidateEvidenceVariant: candidateFindingsAttempt
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
    "candidate-findings",
    "semantic-validation",
    "candidate-findings",
    "semantic-validation",
    "candidate-findings",
    "semantic-validation",
    "review-summary"
  ]);
});

test("ReviewOrchestrator does not stop semantic rerun when Candidate Findings changes only hypothesis closure", async () => {
  const stepEvents: string[] = [];
  let candidateFindingsAttempt = 0;
  const orchestrator = new ReviewOrchestrator({
    workingDirectory: "/workspace/repo",
    timestampProvider: () => "03131435",
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
      async publishArtifact() {}
    }),
    stepRunner: {
      async run({ step, context }) {
        stepEvents.push(step.stepId);
        if (step.stepId === "candidate-findings") {
          candidateFindingsAttempt += 1;
        }
        return buildSemanticLoopStepResult(step.stepId, context.filePath, {
          candidateVariant: 1,
          candidateEvidenceVariant: 1,
          candidateHypothesisClosureVariant: candidateFindingsAttempt
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
    "candidate-findings",
    "semantic-validation",
    "candidate-findings",
    "semantic-validation",
    "candidate-findings",
    "semantic-validation",
    "review-summary"
  ]);
});

test("ReviewOrchestrator stops repeated semantic rerun when only inactive critical missing information changes", async () => {
  const stepEvents: string[] = [];
  let candidateFindingsAttempt = 0;
  const orchestrator = new ReviewOrchestrator({
    workingDirectory: "/workspace/repo",
    timestampProvider: () => "03131436",
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
      async publishArtifact() {}
    }),
    stepRunner: {
      async run({ step, context }) {
        stepEvents.push(step.stepId);
        if (step.stepId === "candidate-findings") {
          candidateFindingsAttempt += 1;
        }
        return buildSemanticLoopStepResult(step.stepId, context.filePath, {
          candidateVariant: 1,
          candidateEvidenceVariant: 1,
          candidateCriticalMissingInformationVariant: candidateFindingsAttempt
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
    "candidate-findings",
    "semantic-validation",
    "candidate-findings",
    "semantic-validation",
    "review-summary"
  ]);
});

test("ReviewOrchestrator honors Semantic Validation missing-critical-contract stop without semantic rerun", async () => {
  const stepEvents: string[] = [];
  let reviewSummaryMissingInformationIds: string[] = [];
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
      async publishArtifact() {}
    }),
    stepRunner: {
      async run({ step, context }) {
        stepEvents.push(step.stepId);
        if (step.stepId === "review-summary") {
          reviewSummaryMissingInformationIds =
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
    "candidate-findings",
    "semantic-validation",
    "review-summary"
  ]);
  assert.deepEqual(reviewSummaryMissingInformationIds, ["MI1"]);
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
    case "run-warning":
      return `run-warning:${event.message}`;
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
    candidateEvidenceVariant?: number;
    candidateHypothesisClosureVariant?: number;
    candidateCriticalMissingInformationVariant?: number;
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

  if (stepId === "candidate-findings") {
    return {
      stepId,
      applyTo(context: FileReviewContext) {
        (context as SemanticFileReviewContext).setCandidateFindings(
          createCandidateFindings(
            options.candidateVariant ?? 1,
            options.candidateEvidenceVariant ?? options.candidateVariant ?? 1,
            options.candidateHypothesisClosureVariant ?? options.candidateVariant ?? 1,
            options.candidateCriticalMissingInformationVariant
          )
        );
      }
    };
  }

  if (stepId === "semantic-validation") {
    return {
      stepId,
      applyTo(context: FileReviewContext) {
        const report = options.validationMode === "missing-critical-stop"
          ? createStopValidationReportV1()
          : createRerunValidationReportV1();
        (context as SemanticFileReviewContext).setValidationReportV1(report);
        if (options.validationMode === "missing-critical-stop") {
          context.setMissingInformationItems(report.missingInformationItems);
          context.setFindings([]);
        }
      }
    };
  }

  if (stepId === "review-summary") {
    return {
      stepId,
      applyTo(context: FileReviewContext) {
        context.setSection("summary", "## Summary\n### 審查結論\n- 已驗證的結果：must-fix 0；nice-to-have 0\n- 審查限制：無\n\n### 審查依據\n- 異動概要：無\n- 已核對依據：無\n- 待確認資訊：無\n### 行為變更提醒\n- 無行為變更");
      }
    };
  }

  throw new Error(`Unexpected step ${stepId}`);
}

type SemanticFileReviewContext = FileReviewContext & {
  setCandidateFindings(
    payload:
      | ReturnType<typeof createCandidateFindings>
      | ReturnType<typeof createMixedCandidateFindings>
      | ReturnType<typeof createRepairedCandidateFindings>
  ): void;
  setValidationReportV1(
    report:
      | ReturnType<typeof createRerunValidationReportV1>
      | ReturnType<typeof createStopValidationReportV1>
      | ReturnType<typeof createMixedRerunValidationReportV1>
      | ReturnType<typeof createAcceptValidationReportV1>
  ): void;
};

function createCandidateFindings(
  variant: number,
  evidenceVariant: number = variant,
  hypothesisClosureVariant: number = variant,
  criticalMissingInformationVariant?: number
) {
  return {
    findings: [
      {
        findingId: "F1",
        priority: "must_fix",
        title: `unsupported claim ${variant}`,
        traceability: { kind: "line-range" as const, lineStart: 1, lineEnd: 1 },
        evidence: `candidate evidence ${evidenceVariant}`,
        triggerCondition: `candidate trigger ${variant}`,
        impact: "candidate impact",
        counterEvidence: ["candidate counter-evidence"]
      }
    ],
    findingOrigins: [
      {
        findingIndex: 1,
        kind: "hypothesis",
        hypothesisIds: ["H1"],
        evidenceIds: ["E1"],
        rationale: `candidate closes H1 with closure evidence ${hypothesisClosureVariant}`
      }
    ],
    hypothesisClosure: [
      {
        hypothesisId: "H1",
        status: "closed_by_candidate",
        rationale: `candidate closes H1 with closure evidence ${hypothesisClosureVariant}`
      }
    ],
    criticalMissingInformation:
      criticalMissingInformationVariant === undefined
        ? []
        : [
            {
              description: `missing contract ${criticalMissingInformationVariant}`,
              whyItMatters: "blocks reliable approval"
            }
          ]
  };
}

function createMixedCandidateFindings() {
  return {
    findings: [
      {
        findingId: "F1",
        priority: "must_fix",
        title: "already proven candidate",
        traceability: { kind: "line-range" as const, lineStart: 1, lineEnd: 1 },
        evidence: "candidate evidence 1",
        triggerCondition: "candidate trigger 1",
        impact: "candidate impact 1",
        counterEvidence: ["candidate counter-evidence 1"]
      },
      {
        findingId: "F2",
        priority: "must_fix",
        title: "candidate needing repair",
        traceability: { kind: "line-range" as const, lineStart: 1, lineEnd: 1 },
        evidence: "candidate evidence 2",
        triggerCondition: "candidate trigger 2",
        impact: "candidate impact needs repair",
        counterEvidence: ["candidate counter-evidence 2"]
      }
    ],
    findingOrigins: [
      {
        findingIndex: 1,
        kind: "hypothesis",
        hypothesisIds: ["H1"],
        evidenceIds: ["E1"],
        rationale: "candidate 1 closes H1"
      },
      {
        findingIndex: 2,
        kind: "supplemental",
        lens: "changed_behavior_sweep",
        evidenceIds: ["E1"],
        rationale: "candidate 2 needs repair",
        relatedHypothesisIds: ["H1"]
      }
    ],
    hypothesisClosure: [
      {
        hypothesisId: "H1",
        status: "closed_by_candidate",
        rationale: "candidate 1 validates the hypothesis"
      }
    ],
    criticalMissingInformation: []
  };
}

function createRepairedCandidateFindings() {
  return {
    findings: [
      {
        findingId: "F1",
        priority: "must_fix",
        title: "repaired candidate",
        traceability: { kind: "line-range" as const, lineStart: 1, lineEnd: 1 },
        evidence: "repaired candidate evidence",
        triggerCondition: "repaired candidate trigger",
        impact: "repaired candidate impact",
        counterEvidence: ["repaired counter-evidence"]
      }
    ],
    findingOrigins: [
      {
        findingIndex: 1,
        kind: "supplemental",
        lens: "changed_behavior_sweep",
        evidenceIds: ["E1"],
        rationale: "candidate 2 was repaired",
        relatedHypothesisIds: ["H1"]
      }
    ],
    hypothesisClosure: [
      {
        hypothesisId: "H1",
        status: "rejected_by_evidence",
        rationale: "H1 was already handled by a terminal semantic decision"
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
        requiredCorrections: ["Prove impact from existing candidate evidence."],
        reason: "impact is unsupported"
      }
    ],
    missingInformationItems: [],
    loopControl: {
      action: "rerun",
      reason: "Candidate Findings must repair machine-actionable evidence gaps"
    }
  };
}

function createMixedRerunValidationReportV1() {
  return {
    perFindingResults: [
      {
        findingId: "F1",
        decision: "approve",
        failedGates: [],
        requiredCorrections: [],
        reason: "all gates passed"
      },
      {
        findingId: "F2",
        decision: "rewrite_required",
        failedGates: ["impact"],
        requiredCorrections: ["Prove impact from existing candidate evidence."],
        reason: "impact is unsupported"
      }
    ],
    missingInformationItems: [],
    loopControl: {
      action: "rerun",
      reason: "one active candidate still needs repair"
    }
  };
}

function createAcceptValidationReportV1() {
  return {
    perFindingResults: [
      {
        findingId: "F1",
        decision: "approve",
        failedGates: [],
        requiredCorrections: [],
        reason: "all gates passed after repair"
      }
    ],
    missingInformationItems: [],
    loopControl: {
      action: "accept",
      reason: "all active candidates passed"
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
    missingInformationItems: [
      {
        itemId: "MI1",
        description: "Need the external null-input contract before approving the candidate.",
        whyItMatters: "Without the contract, Semantic Validation cannot distinguish a real defect from unsupported speculation."
      }
    ],
    loopControl: {
      action: "accept",
      reason: "missing critical contract"
    }
  };
}
