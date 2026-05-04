import type { Finding, FindingTraceability } from "./file-review-context.ts";

export type CandidateClassification =
  | "confirmed_problem"
  | "reasonable_risk"
  | "insufficient_information";

export type CandidatePriority = "must" | "nice" | "none";
export type CandidateSeverity = "high" | "medium" | "low" | "none";
export type CandidateConfidence = "high" | "medium" | "low";
export type EvidenceStrength = "direct" | "indirect" | "insufficient";

export interface CandidateCodeEvidence {
  evidenceId: string;
  location: string;
  summary: string;
}

export interface CandidateFindingV3 {
  findingId: string;
  sourceHypothesisIds: string[];
  classification: CandidateClassification;
  priority: CandidatePriority;
  severity: CandidateSeverity;
  confidence: CandidateConfidence;
  evidenceStrength: EvidenceStrength;
  title: string;
  traceability: FindingTraceability;
  codeEvidence: CandidateCodeEvidence[];
  executionPath: string[];
  triggerCondition: string;
  failureMechanism: string;
  impact: string;
  counterEvidenceChecked: string[];
  reproducibility: string;
  fixDirection: string;
  testRecommendation: string;
}

export type CandidateFindingsResult =
  | "FINDINGS_READY"
  | "NO_FINDINGS"
  | "INSUFFICIENT_INFORMATION";

export type HypothesisClosureStatus =
  | "closed_by_candidate"
  | "rejected_by_evidence"
  | "insufficient_information";

export interface HypothesisClosure {
  hypothesisId: string;
  status: HypothesisClosureStatus;
  evidenceIds: string[];
  rationale: string;
}

export interface CriticalMissingInformation {
  itemId: string;
  description: string;
  whyItMatters: string;
  sourceHypothesisIds?: string[];
}

export interface CandidateFindingsV3 {
  schemaVersion: 3;
  result: CandidateFindingsResult;
  findings: CandidateFindingV3[];
  hypothesisClosure: HypothesisClosure[];
  criticalMissingInformation: CriticalMissingInformation[];
}

export type SemanticGateId =
  | "schema_complete"
  | "anchor_valid"
  | "evidence_refs_exist"
  | "identifiers_valid"
  | "execution_path_concrete"
  | "trigger_concrete"
  | "mechanism_concrete"
  | "impact_proportionate"
  | "counter_evidence_checked"
  | "severity_confidence_aligned"
  | "duplicate_low_value"
  | "hypothesis_closed"
  | "missing_information_honest"
  | "no_new_bug"
  | "repeated_unsupported_claim";

export type ValidationDecision =
  | "approve"
  | "rewrite_required"
  | "downgrade"
  | "drop"
  | "convert_to_missing_information";

export interface PerFindingValidationResult {
  findingId: string;
  decision: ValidationDecision;
  failedGates: SemanticGateId[];
  requiredCorrections: string[];
  recommendedClassification?: CandidateClassification;
  recommendedPriority?: CandidatePriority;
  recommendedSeverity?: CandidateSeverity;
  reason?: string;
}

export interface MissingInformationItem {
  itemId: string;
  findingId?: string;
  description: string;
  whyItMatters: string;
}

export type LoopAction = "accept" | "rerun_step5" | "stop";

export interface LoopControl {
  action: LoopAction;
  reason: string;
}

export type StopReason =
  | "missing_critical_contract"
  | "repeated_unsupported_claim"
  | "unresolved_identifier_hallucination"
  | "max_semantic_reruns";

export type ValidationOverallStatus =
  | "PASS"
  | "RERUN_STEP5"
  | "INSUFFICIENT_INFORMATION_FOR_RELIABLE_REVIEW"
  | "STOPPED";

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
    sourceHypothesisIds: [...finding.sourceHypothesisIds].sort(),
    classification: finding.classification,
    priority: finding.priority,
    severity: finding.severity,
    title: finding.title,
    codeEvidence: finding.codeEvidence.map((entry) => entry.evidenceId).sort(),
    triggerCondition: finding.triggerCondition,
    failureMechanism: finding.failureMechanism,
    impact: finding.impact
  }));

  return JSON.stringify(normalized);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
