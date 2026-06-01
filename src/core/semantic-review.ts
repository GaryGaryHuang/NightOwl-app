import type { Finding } from "./file-review-context.ts";

export const CANDIDATE_CLASSIFICATIONS = [
  "confirmed_problem",
  "reasonable_risk"
] as const;
export type CandidateClassification = (typeof CANDIDATE_CLASSIFICATIONS)[number];

export const CANDIDATE_SEVERITIES = ["high", "low"] as const;
export type CandidateSeverity = (typeof CANDIDATE_SEVERITIES)[number];

/**
 * A Candidate Findings candidate finding. Structurally identical to `Finding`.
 * When approved by Semantic Validation, a candidate becomes the final `Finding` directly.
 */
export type CandidateFinding = Finding;

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

export const SUPPLEMENTAL_LENSES = [
  "changed_behavior_sweep",
  "data_flow_sweep",
  "control_flow_sweep",
  "dependency_contract_sweep",
  "test_contract_sweep"
] as const;
export type SupplementalLens = (typeof SUPPLEMENTAL_LENSES)[number];

export type FindingOrigin =
  | {
      findingIndex: number;
      kind: "hypothesis";
      hypothesisIds: string[];
      evidenceIds: string[];
      rationale: string;
    }
  | {
      findingIndex: number;
      kind: "supplemental";
      lens: SupplementalLens;
      evidenceIds: string[];
      rationale: string;
      relatedHypothesisIds: string[];
    };

export interface CandidateFindings {
  findings: CandidateFinding[];
  findingOrigins: FindingOrigin[];
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

export function cloneCandidateFindings(
  payload: CandidateFindings
): CandidateFindings {
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
  payload: CandidateFindings
): string {
  const normalized = {
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
    findingOrigins: payload.findingOrigins,
    hypothesisClosure: payload.hypothesisClosure,
    criticalMissingInformation: payload.criticalMissingInformation
  };

  return JSON.stringify(normalized);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
