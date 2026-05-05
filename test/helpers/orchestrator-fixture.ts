import type {
  FileReviewContext,
  Finding
} from "../../src/core/file-review-context.ts";
import type { ReviewBasisV1 } from "../../src/core/review-basis.ts";
import type { CandidateFindingsV3, ValidationReportV1 } from "../../src/core/semantic-review.ts";
import type { StepResult } from "../../src/core/step-runner.ts";

export function buildReviewBasis(filePath: string): ReviewBasisV1 {
  return {
    filePath,
    roleInChangeset: `${filePath} participates in the reviewed change.`,
    changedBehavior: [
      {
        before: "old behavior",
        after: "new behavior",
        evidenceIds: ["E1"]
      }
    ],
    facts: [
      {
        statement: `${filePath} has a changed diff hunk.`,
        evidenceIds: ["E1"]
      }
    ],
    inferences: [
      {
        statement: "The changed branch may affect fallback behavior.",
        basedOnEvidenceIds: ["E1"],
        confidence: "medium"
      }
    ],
    dependencyMap: {
      upstreamCallers: [],
      downstreamConsumers: [],
      externalContracts: [],
      sharedStateOrSideEffects: []
    },
    flowMap: {
      entryPoints: [],
      stateTransitions: [],
      asyncBoundaries: [],
      errorPaths: []
    },
    testCoverage: {
      changedTests: [],
      observedCoverageSignals: [],
      coverageGaps: []
    },
    identifierRegistry: {
      files: [filePath],
      symbols: [],
      resourceKeys: [],
      apiNames: [],
      stateNames: []
    },
    hypothesisLedger: [
      {
        hypothesisId: "H1",
        statement: "Fallback behavior could be skipped.",
        triggerCondition: "empty input reaches the changed branch",
      }
    ],
    missingInformation: [],
    evidenceRefs: [
      {
        evidenceId: "E1",
        sourceType: "diff",
        location: filePath,
        summary: "Reviewed file diff."
      }
    ]
  };
}

export function lineRangeTraceability(lineStart: number, lineEnd: number) {
  return {
    kind: "line-range" as const,
    lineStart,
    lineEnd
  };
}

export type Step7NarrativeRiskLevel = "High" | "Low" | "None";

export function buildSummaryResponse(
  filePath: string,
  options: { label?: string; riskLevel?: Step7NarrativeRiskLevel } = {}
): string {
  const label = options.label ?? filePath;
  const riskLevel = options.riskLevel ?? "High";
  return [
    "## Summary",
    "### 審查基礎",
    `- 改動概要：${label} 這次改動主要調整執行流程。`,
    `- 依據規範：依 ${label} 的 repo source-of-truth 與版本假設審查。`,
    "- 必要假設：無。",
    "### 行為變更提醒",
    "- 無",
    "### 風險評估",
    `- 整體風險等級：${riskLevel}`,
    "- 風險理由：final findings 仍需留意。"
  ].join("\n");
}

export function createFinding(type: "must" | "nice", title: string): Finding {
  return {
    type,
    title,
    traceability: { kind: "line-range" as const, lineStart: 1, lineEnd: 1 },
    expectedBehavior: "應維持既有 fallback",
    actualBehavior: "新分支略過 fallback",
    deviation: "預期與實際有落差",
    impact: "會造成 correctness 問題",
    suggestion: "補上 guard",
    findingId: "F1"
  };
}

export function buildFindingsForFile(filePath: string): Finding[] {
  if (filePath === "src/app.ts") {
    return [
      createFinding("must", "must finding"),
      createFinding("nice", "nice finding")
    ];
  }

  if (filePath === "packages/app/index.ts") {
    return [createFinding("must", "only must finding")];
  }

  return [];
}

export interface SuccessfulStepResultOptions {
  onTerminalApply?: () => void;
  findingsByFile?: ReadonlyMap<string, Finding[]>;
  narrativeRiskByFile?: ReadonlyMap<string, Step7NarrativeRiskLevel>;
}

/**
 * Builds a StepResult whose `applyTo` writes to the correct FileReviewContext
 * slot for each step. This mirrors the real step implementations so orchestrator
 * tests can verify state propagation without running an actual Copilot session.
 *
 * The optional `narrativeRiskByFile` map lets tests override the risk level
 * written in the Step 7 summary, enabling assertions on risk-level derivation.
 */
export function buildSuccessfulStepResult(
  stepId: string,
  filePath: string,
  options: SuccessfulStepResultOptions = {}
): StepResult {
  if (stepId === "review-basis") {
    return {
      stepId,
      applyTo(targetContext: FileReviewContext) {
        targetContext.setReviewBasis(buildReviewBasis(filePath));
      }
    };
  }

  if (stepId === "step5-validation-interrogation") {
    return {
      stepId,
      applyTo(targetContext: FileReviewContext) {
        targetContext.setCandidateFindingsV3(buildCandidateFindingsForFile(filePath));
      }
    };
  }

  if (stepId === "step6-cognitive-simulation") {
    return {
      stepId,
      applyTo(targetContext: FileReviewContext) {
        const findings = options.findingsByFile?.get(filePath) ?? buildFindingsForFile(filePath);
        targetContext.setValidationReportV1(buildValidationReportForFindings(findings));
        targetContext.setFindings(findings);
        targetContext.setMissingInformationItems([]);
      }
    };
  }

  if (stepId === "step7-summary") {
    return {
      stepId,
      applyTo(targetContext: FileReviewContext) {
        targetContext.setSection(
          "summary",
          buildSummaryResponse(filePath, { riskLevel: options.narrativeRiskByFile?.get(filePath) })
        );
        options.onTerminalApply?.();
      }
    };
  }

  throw new Error(`Unexpected step: ${stepId}`);
}

function buildCandidateFindingsForFile(filePath: string): CandidateFindingsV3 {
  return {
    result: "FINDINGS_READY",
    findings: [
      {
        findingId: "F1",
        classification: "confirmed_problem",
        severity: "high",
        title: `${filePath} candidate`,
        traceability: { kind: "line-range", lineStart: 1, lineEnd: 1 },
        evidence: "reviewed diff evidence; fallback guard is skipped",
        triggerCondition: "empty input reaches changed branch",
        impact: "會造成 correctness 問題",
        counterEvidence: ["fallback path no longer precedes changed branch"]
      }
    ],
    hypothesisClosure: [
      {
        hypothesisId: "H1",
        status: "closed_by_candidate",
        rationale: "candidate F1 covers the hypothesis"
      }
    ],
    criticalMissingInformation: []
  };
}

function buildValidationReportForFindings(findings: readonly Finding[]): ValidationReportV1 {
  return {
    perFindingResults: findings.map((finding) => ({
      findingId: finding.findingId,
      decision: "approve",
      failedGates: [],
      requiredCorrections: [],
      reason: "all semantic gates passed"
    })),
    approvedFindings: findings.map((finding) => ({ ...finding })),
    missingInformationItems: [],
    loopControl: { action: "accept", reason: "all gates passed" }
  };
}
