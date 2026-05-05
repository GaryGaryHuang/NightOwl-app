import type { Finding, FindingTraceability } from "./file-review-context.ts";

export const CANDIDATE_CLASSIFICATIONS = [
  "confirmed_problem",
  "reasonable_risk"
] as const;
export type CandidateClassification = (typeof CANDIDATE_CLASSIFICATIONS)[number];

export const CANDIDATE_SEVERITIES = ["high", "low"] as const;
export type CandidateSeverity = (typeof CANDIDATE_SEVERITIES)[number];

export interface CandidateFindingV3 {
  findingId: string;
  classification: CandidateClassification;
  severity: CandidateSeverity;
  title: string;
  traceability: FindingTraceability;
  evidence: string;
  triggerCondition: string;
  impact: string;
  counterEvidence: string[];
}

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
  "schema_complete",
  "anchor_valid",
  "evidence_refs_exist",
  "identifiers_valid",
  "execution_path_concrete",
  "trigger_concrete",
  "mechanism_concrete",
  "impact_proportionate",
  "counter_evidence_checked",
  "severity_confidence_aligned",
  "duplicate_low_value",
  "hypothesis_closed",
  "missing_information_honest",
  "no_new_bug",
  "repeated_unsupported_claim"
] as const;
export type SemanticGateId = (typeof SEMANTIC_GATE_IDS)[number];

export const VALIDATION_DECISIONS = [
  "approve",
  "rewrite_required",
  "downgrade",
  "drop",
  "convert_to_missing_information"
] as const;
export type ValidationDecision = (typeof VALIDATION_DECISIONS)[number];

export interface PerFindingValidationResult {
  findingId: string;
  decision: ValidationDecision;
  failedGates: SemanticGateId[];
  requiredCorrections: string[];
  recommendedClassification?: CandidateClassification;
  recommendedSeverity?: CandidateSeverity;
  reason?: string;
}

export interface MissingInformationItem {
  itemId: string;
  findingId?: string;
  description: string;
  whyItMatters: string;
}

export const LOOP_ACTIONS = ["accept", "rerun_step5", "stop"] as const;
export type LoopAction = (typeof LOOP_ACTIONS)[number];

export interface LoopControl {
  action: LoopAction;
  reason: string;
}

export const STOP_REASONS = [
  "missing_critical_contract",
  "repeated_unsupported_claim",
  "unresolved_identifier_hallucination",
  "max_semantic_reruns"
] as const;
export type StopReason = (typeof STOP_REASONS)[number];

export const VALIDATION_OVERALL_STATUSES = [
  "PASS",
  "RERUN_STEP5",
  "INSUFFICIENT_INFORMATION_FOR_RELIABLE_REVIEW",
  "STOPPED"
] as const;
export type ValidationOverallStatus =
  (typeof VALIDATION_OVERALL_STATUSES)[number];

export interface ValidationReportV1 {
  schemaVersion: 1;
  overallStatus: ValidationOverallStatus;
  perFindingResults: PerFindingValidationResult[];
  approvedFindings: Finding[];
  missingInformationItems: MissingInformationItem[];
  loopControl: LoopControl;
  stopReason?: StopReason;
}

export interface SemanticLoopState {
  rerunCount: number;
  candidateFingerprints: string[];
  stopReason?: StopReason;
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
  const normalized = payload.findings.map((finding) => ({
    findingId: finding.findingId,
    classification: finding.classification,
    severity: finding.severity,
    title: finding.title,
    triggerCondition: finding.triggerCondition,
    impact: finding.impact
  }));

  return JSON.stringify(normalized);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
