import type {
  FileReviewContext,
  Finding
} from "../../src/core/file-review-context.ts";
import type { ReviewBasisV1 } from "../../src/core/review-basis.ts";
import type { CandidateFindingsV3, ValidationReportV1 } from "../../src/core/semantic-review.ts";
import type { StepResult } from "../../src/core/step-runner.ts";

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export function buildReviewBasis(filePath: string): ReviewBasisV1 {
  return {
    schemaVersion: 1,
    filePath,
    roleInChangeset: `${filePath} participates in the reviewed change.`,
    changedBehavior: [
      {
        changeId: "CB1",
        before: "old behavior",
        after: "new behavior",
        evidenceIds: ["E1"]
      }
    ],
    facts: [
      {
        factId: "FCT1",
        statement: `${filePath} has a changed diff hunk.`,
        evidenceIds: ["E1"]
      }
    ],
    inferences: [
      {
        inferenceId: "INF1",
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
        whyRelevantHere: "The diff changes the control flow for this file.",
        closureCriteria: ["Trace the changed branch against fallback behavior."]
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

// Identifies the current SOP step from the "## Current Step: <name>" header
// injected into every review session's system message.
export function detectStepId(
  systemMessage: string
):
  | "review-basis"
  | "step5-validation-interrogation"
  | "step6-cognitive-simulation"
  | "step7-summary" {
  if (/## Current Step: ReviewBasis/u.test(systemMessage)) {
    return "review-basis";
  }

  if (/## Current Step: Validation & Interrogation/u.test(systemMessage)) {
    return "step5-validation-interrogation";
  }

  if (/## Current Step: (?:Cognitive Simulation|Semantic Validation)/u.test(systemMessage)) {
    return "step6-cognitive-simulation";
  }

  if (/## Current Step: Summary/u.test(systemMessage)) {
    return "step7-summary";
  }

  throw new Error(`Unable to detect step from system message: ${systemMessage.slice(0, 200)}`);
}

// Extracts the reviewed file path from a step prompt. Two formats are tried:
//   1. <diff path="..."> — used by ReviewBasis and Steps 5–6.
//   2. - Source file: `...`  — used by Step 7 (summary).
export function extractDiffPath(prompt: string): string {
  const match = prompt.match(/<diff path="([^"]+)"/u);

  if (match) {
    return match[1];
  }

  const sourceMatch = prompt.match(/- Source file: `([^`]+)`/u);

  if (sourceMatch) {
    return sourceMatch[1];
  }

  throw new Error(`Missing diff path in prompt: ${prompt}`);
}

export function buildStandardStep5JsonResponse(): string {
  return JSON.stringify({
    schemaVersion: 3,
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
        title: "問題標題",
        traceability: lineRangeTraceability(1, 1),
        codeEvidence: [
          {
            evidenceId: "E1",
            location: "src/app.ts:1",
            summary: "新分支略過 fallback"
          }
        ],
        executionPath: ["entry", "changed branch"],
        triggerCondition: "empty input reaches the changed branch",
        failureMechanism: "fallback guard is skipped",
        impact: "會造成 correctness 問題",
        counterEvidenceChecked: ["fallback path is after the changed branch"],
        reproducibility: "deterministic with empty input",
        fixDirection: "補上 guard",
        testRecommendation: "新增 fallback regression test"
      }
    ],
    hypothesisClosure: [
      {
        hypothesisId: "H1",
        status: "closed_by_candidate",
        evidenceIds: ["E1"],
        rationale: "candidate F1 covers the hypothesis"
      }
    ],
    criticalMissingInformation: []
  });
}

export function buildStandardStep6JsonResponse(): string {
  return JSON.stringify({
    schemaVersion: 1,
    overallStatus: "PASS",
    perFindingResults: [
      {
        findingId: "F1",
        decision: "approve",
        failedGates: [],
        requiredCorrections: [],
        reason: "all semantic gates passed"
      }
    ],
    approvedFindings: [
      {
        type: "must",
        title: "問題標題",
        traceability: lineRangeTraceability(1, 1),
        expectedBehavior: "應維持既有 fallback",
        actualBehavior: "simulation reaches branch without fallback",
        deviation: "預期與實際有落差",
        impact: "會造成 correctness 問題",
        suggestion: "補上 guard",
        findingId: "F1"
      }
    ],
    missingInformationItems: [],
    loopControl: { action: "accept", reason: "all gates passed" }
  });
}

export function buildStandardStep7SummaryResponse(filePath: string): string {
  return [
    "## Summary",
    "### 審查基礎",
    `- 改動概要：${filePath} 這次改動主要調整執行流程。`,
    `- 依據規範：依 ${filePath} 的 repo source-of-truth 與版本假設審查。`,
    "- 必要假設：無。",
    "### 行為變更提醒",
    "- 無",
    "### 風險評估",
    "- 整體風險等級：High",
    "- 風險理由：至少一個 must-fix finding 經驗證後仍成立。"
  ].join("\n");
}

export function buildSimulationStep5JsonResponse(): string {
  return buildStandardStep5JsonResponse();
}

export function buildSimulationStep6JsonResponse(): string {
  return JSON.stringify({
    schemaVersion: 1,
    overallStatus: "PASS",
    perFindingResults: [
      {
        findingId: "F1",
        decision: "approve",
        failedGates: [],
        requiredCorrections: [],
        reason: "all semantic gates passed"
      }
    ],
    approvedFindings: [
      {
        type: "must",
        title: "最終 findings",
        traceability: lineRangeTraceability(1, 1),
        expectedBehavior: "應維持既有 fallback",
        actualBehavior: "simulation confirms fallback is skipped",
        deviation: "經 simulation 後確認最終落差",
        impact: "會造成 correctness 問題",
        suggestion: "補上 final guard",
        findingId: "F1"
      }
    ],
    missingInformationItems: [],
    loopControl: { action: "accept", reason: "all gates passed" }
  });
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
    schemaVersion: 3,
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
        title: `${filePath} candidate`,
        traceability: { kind: "line-range", lineStart: 1, lineEnd: 1 },
        codeEvidence: [
          {
            evidenceId: "E1",
            location: filePath,
            summary: "reviewed diff evidence"
          }
        ],
        executionPath: ["entry", "changed branch"],
        triggerCondition: "empty input reaches changed branch",
        failureMechanism: "fallback guard is skipped",
        impact: "會造成 correctness 問題",
        counterEvidenceChecked: ["fallback path no longer precedes changed branch"],
        reproducibility: "deterministic with empty input",
        fixDirection: "補上 guard",
        testRecommendation: "新增 fallback regression test"
      }
    ],
    hypothesisClosure: [
      {
        hypothesisId: "H1",
        status: "closed_by_candidate",
        evidenceIds: ["E1"],
        rationale: "candidate F1 covers the hypothesis"
      }
    ],
    criticalMissingInformation: []
  };
}

function buildValidationReportForFindings(findings: readonly Finding[]): ValidationReportV1 {
  return {
    schemaVersion: 1,
    overallStatus: "PASS",
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
