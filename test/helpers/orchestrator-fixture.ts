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

export type ReviewSummaryNarrativeRiskLevel = "High" | "Low" | "None";

export function buildSummaryResponse(
  filePath: string,
  options: { label?: string; riskLevel?: ReviewSummaryNarrativeRiskLevel } = {}
): string {
  const label = options.label ?? filePath;
  const riskLevel = options.riskLevel ?? "High";
  return [
    "## Summary",
    "### 審查結論",
    "- 結論：測試結論",
    `- 整體風險等級：${riskLevel}`,
    "- 已驗證的結果：must-fix 1；nice-to-have 0",
    "- 審查限制：無",
    "",
    "### 審查依據",
    `- 異動概要：${label} 這次改動主要調整執行流程。`,
    `- 已核對依據：依 ${label} 的 repo source-of-truth 與版本假設審查。`,
    "- 待確認資訊：無。",
    "### 行為變更提醒",
    "- 無行為變更",
    "### 風險判定理由",
    "- final findings 仍需留意。",
    "",
    "### 後續行動",
    "- 測試 fixture action。"
  ].join("\n");
}

export function createFinding(type: "must" | "nice", title: string): Finding {
  const classification = type === "must" ? "confirmed_problem" : "reasonable_risk";
  const severity = type === "must" ? "high" : "low";
  return {
    findingId: "F1",
    classification,
    severity,
    title,
    traceability: { kind: "line-range" as const, lineStart: 1, lineEnd: 1 },
    evidence: "concrete code evidence",
    triggerCondition: "trigger condition",
    impact: "會造成 correctness 問題",
    counterEvidence: ["checked alternative"]
  } as Finding;
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
  narrativeRiskByFile?: ReadonlyMap<string, ReviewSummaryNarrativeRiskLevel>;
}

/**
 * Builds a StepResult whose `applyTo` writes to the correct FileReviewContext
 * slot for each step. This mirrors the real step implementations so orchestrator
 * tests can verify state propagation without running an actual Copilot session.
 *
 * The optional `narrativeRiskByFile` map lets tests override the risk level
 * written in the Review Summary summary, enabling assertions on risk-level derivation.
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

  if (stepId === "candidate-findings") {
    return {
      stepId,
      applyTo(targetContext: FileReviewContext) {
        targetContext.setCandidateFindingsV3(buildCandidateFindingsForFile(filePath));
      }
    };
  }

  if (stepId === "semantic-validation") {
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

  if (stepId === "review-summary") {
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
    missingInformationItems: [],
    loopControl: { action: "accept", reason: "all gates passed" }
  };
}
