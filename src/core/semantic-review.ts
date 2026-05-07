import type { Finding } from "./file-review-context.ts";

export const CANDIDATE_CLASSIFICATIONS = [
  "confirmed_problem",
  "reasonable_risk"
] as const;
export type CandidateClassification = (typeof CANDIDATE_CLASSIFICATIONS)[number];

export const CANDIDATE_SEVERITIES = ["high", "low"] as const;
export type CandidateSeverity = (typeof CANDIDATE_SEVERITIES)[number];

/**
 * A Step 5 candidate finding. Structurally identical to `Finding` (minus optional fields).
 * When approved by Step 6, a candidate becomes the final `Finding` directly.
 */
export type CandidateFindingV3 = Finding;

export const CANDIDATE_FINDINGS_RESULTS = [
  "FINDINGS_READY",
  "NO_FINDINGS",
  "INSUFFICIENT_INFORMATION"
] as const;
export type CandidateFindingsResult =
  (typeof CANDIDATE_FINDINGS_RESULTS)[number];

export const HYPOTHESIS_CLOSURE_STATUSES = [
  "closed_by_candidate",
  "rejected_by_evidence",
  "insufficient_information"
] as const;
export type HypothesisClosureStatus =
  (typeof HYPOTHESIS_CLOSURE_STATUSES)[number];

export interface HypothesisClosure {
  hypothesisId: string;
  status: HypothesisClosureStatus;
  rationale: string;
}

export interface CriticalMissingInformation {
  description: string;
  whyItMatters: string;
}

export interface CandidateFindingsV3 {
  result: CandidateFindingsResult;
  findings: CandidateFindingV3[];
  hypothesisClosure: HypothesisClosure[];
  criticalMissingInformation: CriticalMissingInformation[];
}

export const SEMANTIC_GATE_IDS = [
  "evidence",
  "impact",
  "traceability",
  "completeness",
  "scope"
] as const;
export type SemanticGateId = (typeof SEMANTIC_GATE_IDS)[number];

export const VALIDATION_DECISIONS = [
  "approve",
  "rewrite_required",
  "drop"
] as const;
export type ValidationDecision = (typeof VALIDATION_DECISIONS)[number];

export interface PerFindingValidationResult {
  findingId: string;
  decision: ValidationDecision;
  failedGates: SemanticGateId[];
  requiredCorrections: string[];
  reason: string;
}

export interface MissingInformationItem {
  itemId: string;
  description: string;
  whyItMatters: string;
}

export const LOOP_ACTIONS = ["accept", "rerun"] as const;
export type LoopAction = (typeof LOOP_ACTIONS)[number];

export interface LoopControl {
  action: LoopAction;
  reason: string;
}

export interface ValidationReportV1 {
  perFindingResults: PerFindingValidationResult[];
  missingInformationItems: MissingInformationItem[];
  loopControl: LoopControl;
}

export function cloneCandidateFindingsV3(
  payload: CandidateFindingsV3
): CandidateFindingsV3 {
  return cloneJson(payload);
}

export function cloneValidationReportV1(
  report: ValidationReportV1
): ValidationReportV1 {
  return cloneJson(report);
}

export function cloneMissingInformationItems(
  items: readonly MissingInformationItem[]
): MissingInformationItem[] {
  return cloneJson([...items]);
}

export function semanticCandidateFingerprint(
  payload: CandidateFindingsV3
): string {
  const normalized = {
    result: payload.result,
    findings: payload.findings.map((finding) => ({
      findingId: finding.findingId,
      classification: finding.classification,
      severity: finding.severity,
      title: finding.title,
      traceability: finding.traceability,
      evidence: finding.evidence,
      triggerCondition: finding.triggerCondition,
      impact: finding.impact,
      counterEvidence: finding.counterEvidence,
      dependencyPathException: finding.dependencyPathException
    })),
    hypothesisClosure: payload.hypothesisClosure,
    criticalMissingInformation: payload.criticalMissingInformation
  };

  return JSON.stringify(normalized);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
