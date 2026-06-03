import type {
  DependencyPathException,
  Finding,
  FindingTraceability
} from "./file-review-context.ts";
import type { ReviewBasis } from "./review-basis.ts";
import type {
  CandidateFindings,
  CandidatePriority,
  CriticalMissingInformation,
  FindingOrigin,
  HypothesisClosure,
  HypothesisClosureStatus,
  LoopAction,
  LoopControl,
  MissingInformationItem,
  PerFindingValidationResult,
  SemanticGateId,
  SupplementalLens,
  ValidationDecision,
  ValidationReportV1
} from "./semantic-review.ts";
import {
  CANDIDATE_PRIORITIES as RUNTIME_CANDIDATE_PRIORITIES,
  HYPOTHESIS_CLOSURE_STATUSES as RUNTIME_HYPOTHESIS_CLOSURE_STATUSES,
  LOOP_ACTIONS as RUNTIME_LOOP_ACTIONS,
  SEMANTIC_GATE_IDS as RUNTIME_SEMANTIC_GATE_IDS,
  SUPPLEMENTAL_LENSES as RUNTIME_SUPPLEMENTAL_LENSES,
  VALIDATION_DECISIONS as RUNTIME_VALIDATION_DECISIONS
} from "./semantic-review.ts";
import type { StructuredValidationReportEntry } from "./validation-report.ts";

const MAX_SUPPLEMENTAL_FINDINGS_PER_FILE = 2;

export class StructuredValidationReportError extends Error {
  readonly report: readonly StructuredValidationReportEntry[];

  constructor(message: string, report: readonly StructuredValidationReportEntry[]) {
    super(message);
    this.name = "StructuredValidationReportError";
    this.report = report.map((entry) => ({ ...entry }));
  }
}

export class StructuredOutputValidator {
  validateCandidateFindingsWithReport(input: {
    responseText: string;
    reviewBasis: ReviewBasis;
    previousCandidateFindings?: CandidateFindings;
  }): { payload: CandidateFindings; report: StructuredValidationReportEntry[] } {
    const report: StructuredValidationReportEntry[] = [];

    try {
      const record = parseTopLevelObject(
        input.responseText,
        "top-level payload must be an object with a CandidateFindings shape"
      );
      const payload = validateCandidateFindingsRecord({
        record,
        reviewBasis: input.reviewBasis
      });
      if (input.previousCandidateFindings !== undefined) {
        assertSemanticRerunPreservesCandidateScope({
          previous: input.previousCandidateFindings,
          current: payload
        });
      }

      for (const finding of payload.findings) {
        report.push({
          findingId: finding.findingId,
          taxonomy: "OK",
          outcome: "accepted",
          gate: "schema",
          reason: "passed CandidateFindings schema validation"
        });
        report.push({
          findingId: finding.findingId,
          taxonomy: "OK",
          outcome: "accepted",
          gate: "semantic",
          reason: "passed CandidateFindings semantic gates"
        });
      }

      return { payload, report };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (report.length === 0 || report.every((entry) => entry.outcome !== "rejected")) {
        report.push({
          findingId: extractReportableFindingIdFromText(input.responseText) ?? "<payload>",
          taxonomy: "SEMANTIC",
          outcome: "rejected",
          gate: "semantic",
          reason
        });
      }
      throw new StructuredValidationReportError(
        "deterministic validation failed: CandidateFindings failed validation",
        report
      );
    }
  }

  validateValidationReportV1WithReport(input: {
    responseText: string;
    candidateFindings: CandidateFindings | Record<string, unknown>;
    reviewBasis?: ReviewBasis;
  }): { payload: ValidationReportV1; report: StructuredValidationReportEntry[] } {
    const report: StructuredValidationReportEntry[] = [];

    try {
      const record = parseTopLevelObject(
        input.responseText,
        "top-level payload must be an object with a ValidationReportV1 shape"
      );
      const candidatePayload = coerceCandidateFindingsForValidation({
        input: input.candidateFindings,
        reviewBasis: input.reviewBasis
      });
      const payload = validateValidationReportV1Record({
        record,
        candidatePayload
      });

      for (const result of payload.perFindingResults) {
        report.push({
          findingId: result.findingId,
          taxonomy: result.decision === "approve" ? "OK" : "SEMANTIC",
          outcome: result.decision === "approve" ? "accepted" : "rejected",
          gate: "semantic",
          reason: result.reason
        });
      }

      return { payload, report };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (report.length === 0 || report.every((entry) => entry.outcome !== "rejected")) {
        report.push({
          findingId: extractReportableFindingIdFromText(input.responseText) ?? "<payload>",
          taxonomy: "SEMANTIC",
          outcome: "rejected",
          gate: "semantic",
          reason
        });
      }
      throw new StructuredValidationReportError(
        "deterministic validation failed: ValidationReportV1 failed validation",
        report
      );
    }
  }

}

function validateCandidateFindingsRecord(input: {
  record: Record<string, unknown>;
  reviewBasis: ReviewBasis;
}): CandidateFindings {
  const findings = validateArray(input.record.findings, "findings").map(
    (finding, index) =>
      validateCandidateFinding({
        input: finding,
        index
      })
  );
  // Auto-assign findingId
  for (let i = 0; i < findings.length; i++) {
    findings[i] = { ...findings[i], findingId: `F${i + 1}` };
  }

  const hypothesisClosure = validateArray(
    input.record.hypothesisClosure,
    "hypothesisClosure"
  ).map((closure, index) =>
    validateHypothesisClosure(closure, index, input.reviewBasis)
  );
  assertHypothesisClosureCoversReviewBasis(
    hypothesisClosure,
    input.reviewBasis
  );

  const findingOrigins = validateArray(
    input.record.findingOrigins,
    "findingOrigins"
  ).map((origin, index) =>
    validateFindingOrigin({
      input: origin,
      index,
      findingsLength: findings.length,
      reviewBasis: input.reviewBasis
    })
  );
  assertFindingOriginsCoverFindings({
    origins: findingOrigins,
    findingsLength: findings.length
  });
  assertSupplementalFindingLimit(findingOrigins);
  assertFindingOriginsMatchHypothesisClosure({
    origins: findingOrigins,
    hypothesisClosure
  });

  const criticalMissingInformation = validateArray(
    input.record.criticalMissingInformation,
    "criticalMissingInformation"
  ).map((item, index) => validateCriticalMissingInformation(item, index));
  assertInsufficientHypothesesHaveCriticalMissingInformation({
    hypothesisClosure,
    criticalMissingInformation
  });
  assertCriticalMissingInformationAlignment({
    hypothesisClosure,
    criticalMissingInformation
  });

  return {
    findings,
    findingOrigins,
    hypothesisClosure,
    criticalMissingInformation
  };
}

function validateCandidateFinding(input: {
  input: unknown;
  index: number;
}): Finding {
  if (!input.input || typeof input.input !== "object" || Array.isArray(input.input)) {
    throw new Error(
      `deterministic validation failed: findings[${input.index}] must be a non-null object`
    );
  }

  const record = input.input as Record<string, unknown>;
  const priority = validateEnum<CandidatePriority>(
    record.priority,
    VALID_CANDIDATE_PRIORITIES,
    "priority"
  );

  const dependencyPathException = validateDependencyPathException(
    record.dependencyPathException,
    `findings[${input.index}].dependencyPathException`
  );
  const traceability = validateTraceability(record.traceability);

  const evidence = validateStringField(record.evidence, "evidence");
  const triggerCondition = validateStringField(
    record.triggerCondition,
    "triggerCondition"
  );
  const impact = validateStringField(record.impact, "impact");
  const counterEvidence = validateStringArray(
    record.counterEvidence,
    "counterEvidence",
    { nonEmpty: true }
  );

  return {
    findingId: "", // placeholder; overwritten by caller
    priority,
    title: validateStringField(record.title, "title"),
    traceability,
    evidence,
    triggerCondition,
    impact,
    counterEvidence,
    ...(dependencyPathException === undefined
      ? {}
      : { dependencyPathException })
  };
}

function validateFindingOrigin(input: {
  input: unknown;
  index: number;
  findingsLength: number;
  reviewBasis: ReviewBasis;
}): FindingOrigin {
  if (!input.input || typeof input.input !== "object" || Array.isArray(input.input)) {
    throw new Error(
      `deterministic validation failed: findingOrigins[${input.index}] must be a non-null object`
    );
  }

  const record = input.input as Record<string, unknown>;
  const fieldName = `findingOrigins[${input.index}]`;
  const findingIndex = validatePositiveInteger(
    record.findingIndex,
    `${fieldName}.findingIndex`
  );
  if (findingIndex > input.findingsLength) {
    throw new Error(
      `deterministic validation failed: ${fieldName}.findingIndex references unknown finding index ${findingIndex}`
    );
  }

  const kind = validateEnum<"hypothesis" | "supplemental">(
    record.kind,
    ["hypothesis", "supplemental"],
    `${fieldName}.kind`
  );
  const evidenceIds = validateReviewBasisEvidenceIds({
    value: record.evidenceIds,
    fieldName: `${fieldName}.evidenceIds`,
    reviewBasis: input.reviewBasis,
    nonEmpty: true
  });
  const rationale = validateStringField(record.rationale, `${fieldName}.rationale`);

  if (kind === "hypothesis") {
    return {
      findingIndex,
      kind,
      hypothesisIds: validateReviewBasisHypothesisIds({
        value: record.hypothesisIds,
        fieldName: `${fieldName}.hypothesisIds`,
        reviewBasis: input.reviewBasis,
        nonEmpty: true
      }),
      evidenceIds,
      rationale
    };
  }

  return {
    findingIndex,
    kind,
    lens: validateEnum<SupplementalLens>(
      record.lens,
      VALID_SUPPLEMENTAL_LENSES,
      `${fieldName}.lens`
    ),
    evidenceIds,
    rationale,
    relatedHypothesisIds: validateReviewBasisHypothesisIds({
      value: record.relatedHypothesisIds,
      fieldName: `${fieldName}.relatedHypothesisIds`,
      reviewBasis: input.reviewBasis
    })
  };
}

function validateReviewBasisEvidenceIds(input: {
  value: unknown;
  fieldName: string;
  reviewBasis: ReviewBasis;
  nonEmpty?: boolean;
}): string[] {
  const ids = validateStringArray(input.value, input.fieldName, {
    nonEmpty: input.nonEmpty
  });
  const validIds = new Set(input.reviewBasis.evidenceRefs.map((ref) => ref.evidenceId));
  for (const id of ids) {
    if (!validIds.has(id)) {
      throw new Error(
        `deterministic validation failed: ${input.fieldName} references unknown ReviewBasis evidenceId ${id}`
      );
    }
  }
  return ids;
}

function validateReviewBasisHypothesisIds(input: {
  value: unknown;
  fieldName: string;
  reviewBasis: ReviewBasis;
  nonEmpty?: boolean;
}): string[] {
  const ids = validateStringArray(input.value, input.fieldName, {
    nonEmpty: input.nonEmpty
  });
  const validIds = new Set(
    input.reviewBasis.hypothesisLedger.map((hypothesis) => hypothesis.hypothesisId)
  );
  for (const id of ids) {
    if (!validIds.has(id)) {
      throw new Error(
        `deterministic validation failed: ${input.fieldName} references unknown ReviewBasis hypothesisId ${id}`
      );
    }
  }
  return ids;
}

function assertFindingOriginsCoverFindings(input: {
  origins: readonly FindingOrigin[];
  findingsLength: number;
}): void {
  const seen = new Set<number>();
  for (const origin of input.origins) {
    if (seen.has(origin.findingIndex)) {
      throw new Error(
        `deterministic validation failed: findingOrigins contains duplicate findingIndex ${origin.findingIndex}`
      );
    }
    seen.add(origin.findingIndex);
  }

  for (let findingIndex = 1; findingIndex <= input.findingsLength; findingIndex += 1) {
    if (!seen.has(findingIndex)) {
      throw new Error(
        `deterministic validation failed: findingOrigins is missing origin for findingIndex ${findingIndex}`
      );
    }
  }
}

function assertSupplementalFindingLimit(
  origins: readonly FindingOrigin[]
): void {
  const supplementalCount = origins.filter(
    (origin) => origin.kind === "supplemental"
  ).length;
  if (supplementalCount > MAX_SUPPLEMENTAL_FINDINGS_PER_FILE) {
    throw new Error(
      `deterministic validation failed: supplemental findingOrigins must not exceed ${MAX_SUPPLEMENTAL_FINDINGS_PER_FILE} per file`
    );
  }
}

function assertFindingOriginsMatchHypothesisClosure(input: {
  origins: readonly FindingOrigin[];
  hypothesisClosure: readonly HypothesisClosure[];
}): void {
  const statusByHypothesis = new Map(
    input.hypothesisClosure.map((closure) => [closure.hypothesisId, closure.status])
  );
  const hypothesisOriginRefs = new Set<string>();

  for (const origin of input.origins) {
    if (origin.kind !== "hypothesis") {
      continue;
    }
    for (const hypothesisId of origin.hypothesisIds) {
      const status = statusByHypothesis.get(hypothesisId);
      if (status !== "closed_by_candidate") {
        throw new Error(
          `deterministic validation failed: hypothesis findingOrigin references ${hypothesisId} with status ${status ?? "missing"} instead of closed_by_candidate`
        );
      }
      hypothesisOriginRefs.add(hypothesisId);
    }
  }

  for (const closure of input.hypothesisClosure) {
    if (
      closure.status === "closed_by_candidate" &&
      !hypothesisOriginRefs.has(closure.hypothesisId)
    ) {
      throw new Error(
        `deterministic validation failed: ${closure.hypothesisId} is closed_by_candidate but not referenced by findingOrigins hypothesis origin`
      );
    }
  }
}

function validateValidationReportV1Record(input: {
  record: Record<string, unknown>;
  candidatePayload: CandidateFindings;
}): ValidationReportV1 {
  const candidateIds = input.candidatePayload.findings.map((f) => f.findingId);
  const candidateIdSet = new Set(candidateIds);
  const perFindingResults = validateArray(
    input.record.perFindingResults,
    "perFindingResults"
  ).map((item, index) =>
    validatePerFindingValidationResult(item, index, candidateIdSet)
  );
  assertPerFindingResultsCoverCandidates(perFindingResults, candidateIds);

  const missingInformationItems = validateArray(
    input.record.missingInformationItems,
    "missingInformationItems"
  ).map((item, index) => validateMissingInformationItem(item, index));
  // Auto-assign itemId
  for (let i = 0; i < missingInformationItems.length; i++) {
    missingInformationItems[i] = { ...missingInformationItems[i], itemId: `MI${i + 1}` };
  }
  assertValidationReportMatchesCandidatePayload({
    candidatePayload: input.candidatePayload,
    perFindingResults,
    missingInformationItems
  });

  const loopControl = validateLoopControl(input.record.loopControl);
  validateLoopControlAlignment({
    perFindingResults,
    loopControl
  });

  return {
    perFindingResults,
    missingInformationItems,
    loopControl
  };
}

function validateLoopControlAlignment(input: {
  perFindingResults: readonly PerFindingValidationResult[];
  loopControl: LoopControl;
}): void {
  const hasRewrite = input.perFindingResults.some((r) => r.decision === "rewrite_required");
  if (input.loopControl.action === "rerun") {
    if (!hasRewrite) {
      throw new Error(
        "deterministic validation failed: rerun requires at least one rewrite_required decision"
      );
    }
  }

  if (input.loopControl.action === "accept" && hasRewrite) {
    throw new Error(
      "deterministic validation failed: accept loopControl must not leave rewrite_required candidates unresolved"
    );
  }
}

function validateHypothesisClosure(
  input: unknown,
  index: number,
  reviewBasis: ReviewBasis
): HypothesisClosure {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(
      `deterministic validation failed: hypothesisClosure[${index}] must be a non-null object`
    );
  }
  const record = input as Record<string, unknown>;
  const hypothesisId = validateStringField(
    record.hypothesisId,
    `hypothesisClosure[${index}].hypothesisId`
  );
  if (!reviewBasis.hypothesisLedger.some((h) => h.hypothesisId === hypothesisId)) {
    throw new Error(
      `deterministic validation failed: ${hypothesisId} is not present in ReviewBasis hypothesisLedger`
    );
  }
  return {
    hypothesisId,
    status: validateEnum<HypothesisClosureStatus>(
      record.status,
      VALID_HYPOTHESIS_CLOSURE_STATUSES,
      `hypothesisClosure[${index}].status`
    ),
    rationale: validateStringField(
      record.rationale,
      `hypothesisClosure[${index}].rationale`
    )
  };
}

function assertHypothesisClosureCoversReviewBasis(
  closures: readonly HypothesisClosure[],
  reviewBasis: ReviewBasis
): void {
  const closureIds = new Set<string>();
  for (const closure of closures) {
    if (closureIds.has(closure.hypothesisId)) {
      throw new Error(
        `deterministic validation failed: ${closure.hypothesisId} appears more than once in hypothesisClosure`
      );
    }
    closureIds.add(closure.hypothesisId);
  }

  for (const hypothesis of reviewBasis.hypothesisLedger) {
    if (!closureIds.has(hypothesis.hypothesisId)) {
      throw new Error(
        `deterministic validation failed: ${hypothesis.hypothesisId} missing from hypothesisClosure`
      );
    }
  }
}

function assertInsufficientHypothesesHaveCriticalMissingInformation(input: {
  hypothesisClosure: readonly HypothesisClosure[];
  criticalMissingInformation: readonly CriticalMissingInformation[];
}): void {
  const hasInsufficientHypothesis = input.hypothesisClosure.some(
    (closure) => closure.status === "insufficient_information"
  );
  if (hasInsufficientHypothesis && input.criticalMissingInformation.length === 0) {
    throw new Error(
      "deterministic validation failed: insufficient_information hypothesisClosure entries require criticalMissingInformation"
    );
  }
}

function assertCriticalMissingInformationAlignment(input: {
  hypothesisClosure: readonly HypothesisClosure[];
  criticalMissingInformation: readonly CriticalMissingInformation[];
}): void {
  if (input.criticalMissingInformation.length === 0) {
    return;
  }

  const hasInsufficientHypothesis = input.hypothesisClosure.some(
    (closure) => closure.status === "insufficient_information"
  );
  if (!hasInsufficientHypothesis) {
    throw new Error(
      "deterministic validation failed: criticalMissingInformation requires an insufficient_information hypothesisClosure entry"
    );
  }
}

function assertSemanticRerunPreservesCandidateScope(input: {
  previous: CandidateFindings;
  current: CandidateFindings;
}): void {
  if (input.current.findings.length > input.previous.findings.length) {
    throw new Error(
      "deterministic validation failed: semantic rerun CandidateFindings must not introduce more candidates than the previous candidate payload"
    );
  }

  if (
    countSupplementalOrigins(input.current.findingOrigins) >
    countSupplementalOrigins(input.previous.findingOrigins)
  ) {
    throw new Error(
      "deterministic validation failed: semantic rerun CandidateFindings must not introduce more supplemental candidates than the previous candidate payload"
    );
  }
}

function countSupplementalOrigins(
  origins: readonly FindingOrigin[]
): number {
  return origins.filter((origin) => origin.kind === "supplemental").length;
}

function assertValidationReportMatchesCandidatePayload(input: {
  candidatePayload: CandidateFindings;
  perFindingResults: readonly PerFindingValidationResult[];
  missingInformationItems: readonly MissingInformationItem[];
}): void {
  if (
    input.candidatePayload.criticalMissingInformation.length > 0 &&
    input.missingInformationItems.length === 0
  ) {
    throw new Error(
      "deterministic validation failed: CandidateFindings criticalMissingInformation must be represented in ValidationReportV1 missingInformationItems"
    );
  }
}

function validateCriticalMissingInformation(
  input: unknown,
  index: number
): CriticalMissingInformation {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(
      `deterministic validation failed: criticalMissingInformation[${index}] must be a non-null object`
    );
  }
  const record = input as Record<string, unknown>;
  return {
    description: validateStringField(record.description, `criticalMissingInformation[${index}].description`),
    whyItMatters: validateStringField(record.whyItMatters, `criticalMissingInformation[${index}].whyItMatters`)
  };
}

function validatePerFindingValidationResult(
  input: unknown,
  index: number,
  candidateIdSet: ReadonlySet<string>
): PerFindingValidationResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(
      `deterministic validation failed: perFindingResults[${index}] must be a non-null object`
    );
  }
  const record = input as Record<string, unknown>;
  const findingId = validateStringField(
    record.findingId,
    `perFindingResults[${index}].findingId`
  );
  if (!candidateIdSet.has(findingId)) {
    throw new Error(
      `deterministic validation failed: perFindingResults entry ${findingId} references unknown candidate`
    );
  }
  const result: PerFindingValidationResult = {
    findingId,
    decision: validateEnum<ValidationDecision>(
      record.decision,
      VALID_VALIDATION_DECISIONS,
      `perFindingResults[${index}].decision`
    ),
    failedGates: validateSemanticGateArray(
      record.failedGates,
      `perFindingResults[${index}].failedGates`
    ),
    requiredCorrections: validateStringArray(
      record.requiredCorrections,
      `perFindingResults[${index}].requiredCorrections`,
      { defaultEmpty: true, acceptSingleString: true }
    ),
    reason: validateStringField(
      record.reason,
      `perFindingResults[${index}].reason`
    )
  };

  validatePerFindingDecisionConsistency(result, index);

  return result;
}

function validatePerFindingDecisionConsistency(
  result: PerFindingValidationResult,
  index: number
): void {
  if (result.decision === "approve") {
    if (result.failedGates.length > 0) {
      throw new Error(
        `deterministic validation failed: perFindingResults[${index}] approve decision must not include failedGates`
      );
    }
    if (result.requiredCorrections.length > 0) {
      throw new Error(
        `deterministic validation failed: perFindingResults[${index}] approve decision must not include requiredCorrections`
      );
    }
  }

  if (result.decision === "rewrite_required") {
    if (result.requiredCorrections.length === 0) {
      throw new Error(
        `deterministic validation failed: perFindingResults[${index}] rewrite_required decision requires at least one requiredCorrection`
      );
    }
  }
}

function assertPerFindingResultsCoverCandidates(
  results: readonly PerFindingValidationResult[],
  candidateIds: readonly string[]
): void {
  const resultIds = new Set<string>();
  for (const result of results) {
    if (resultIds.has(result.findingId)) {
      throw new Error(
        `deterministic validation failed: perFindingResults entry ${result.findingId} appears more than once`
      );
    }
    resultIds.add(result.findingId);
  }

  for (const candidateId of candidateIds) {
    if (!resultIds.has(candidateId)) {
      throw new Error(
        `deterministic validation failed: candidate ${candidateId} is missing from perFindingResults`
      );
    }
  }
}

function validateMissingInformationItem(
  input: unknown,
  index: number
): MissingInformationItem {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(
      `deterministic validation failed: missingInformationItems[${index}] must be a non-null object`
    );
  }
  const record = input as Record<string, unknown>;
  return {
    itemId: "", // placeholder; overwritten by caller
    description: validateStringField(record.description, `missingInformationItems[${index}].description`),
    whyItMatters: validateStringField(record.whyItMatters, `missingInformationItems[${index}].whyItMatters`)
  };
}

function validateLoopControl(input: unknown): { action: LoopAction; reason: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(
      "deterministic validation failed: loopControl must be a non-null object"
    );
  }
  const record = input as Record<string, unknown>;
  const action = validateEnum<LoopAction>(
    record.action,
    VALID_LOOP_ACTIONS,
    "loopControl.action"
  );

  return {
    action,
    reason: validateOptionalStringField(
      record.reason,
      defaultLoopControlReason(action)
    )
  };
}

function coerceCandidateFindingsForValidation(input: {
  input: CandidateFindings | Record<string, unknown>;
  reviewBasis: ReviewBasis | undefined;
}): CandidateFindings {
  if (!input.input || typeof input.input !== "object" || Array.isArray(input.input)) {
    throw new Error(
      "deterministic validation failed: candidateFindings must be CandidateFindings"
    );
  }
  if (input.reviewBasis === undefined) {
    throw new Error(
      "deterministic validation failed: reviewBasis is required to validate complete CandidateFindings before ValidationReportV1"
    );
  }

  // Strip auto-generated fields before re-validation
  const rawRecord = { ...(input.input as Record<string, unknown>) };
  if (Array.isArray(rawRecord.findings)) {
    rawRecord.findings = (rawRecord.findings as Record<string, unknown>[]).map(
      (f) => {
        const { findingId, ...rest } = f;
        return rest;
      }
    );
  }

  return validateCandidateFindingsRecord({
    record: rawRecord,
    reviewBasis: input.reviewBasis
  });
}

function validateDependencyPathException(
  input: unknown,
  fieldName: string
): DependencyPathException | undefined {
  if (input === undefined) {
    return undefined;
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(
      `deterministic validation failed: '${fieldName}' must be a non-null object`
    );
  }
  const record = input as Record<string, unknown>;

  const dependencyAnchor = record.dependencyAnchor;
  if (
    !dependencyAnchor ||
    typeof dependencyAnchor !== "object" ||
    Array.isArray(dependencyAnchor)
  ) {
    throw new Error(
      `deterministic validation failed: '${fieldName}.dependencyAnchor' must be a non-null object`
    );
  }

  const anchorRecord = dependencyAnchor as Record<string, unknown>;
  const symbol = anchorRecord.symbol === undefined
    ? undefined
    : validateStringField(anchorRecord.symbol, `${fieldName}.dependencyAnchor.symbol`);

  return {
    reason: validateStringField(record.reason, `${fieldName}.reason`),
    dependencyAnchor: {
      filePath: validateStringField(
        anchorRecord.filePath,
        `${fieldName}.dependencyAnchor.filePath`
      ),
      ...(symbol === undefined ? {} : { symbol })
    }
  };
}

function extractReportableFindingId(input: unknown): string | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }

  const value = (input as Record<string, unknown>).findingId;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function extractReportableFindingIdFromText(responseText: string): string | undefined {
  try {
    const parsed = JSON.parse(responseText) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    const record = parsed as Record<string, unknown>;
    const findings = Array.isArray(record.findings)
      ? record.findings
      : undefined;
    if (!findings) {
      return undefined;
    }
    for (const finding of findings) {
      const id = extractReportableFindingId(finding);
      if (id) {
        return id;
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function validateTraceability(input: unknown): FindingTraceability {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(
      "deterministic validation failed: 'traceability' must be a non-null object"
    );
  }

  const traceability = input as Record<string, unknown>;
  const kind = validateStringField(traceability.kind, "traceability.kind");

  if (kind === "line-range") {
    const lineStart = validatePositiveInteger(
      traceability.lineStart,
      "traceability.lineStart"
    );
    const lineEnd = validatePositiveInteger(
      traceability.lineEnd,
      "traceability.lineEnd"
    );

    if (lineEnd < lineStart) {
      throw new Error(
        "deterministic validation failed: 'traceability.lineEnd' must be >= 'traceability.lineStart'"
      );
    }

    return {
      kind,
      lineStart,
      lineEnd
    };
  }

  if (kind === "diff-hunk") {
    const hunkHeader = validateStringField(
      traceability.hunkHeader,
      "traceability.hunkHeader"
    );

    return {
      kind,
      hunkHeader
    };
  }

  throw new Error(
    "deterministic validation failed: unsupported traceability kind"
  );
}

function validatePositiveInteger(value: unknown, fieldName: string): number {
  const normalized = typeof value === "string" && /^\d+$/u.test(value.trim())
    ? Number(value.trim())
    : value;

  if (
    typeof normalized !== "number" ||
    !Number.isInteger(normalized) ||
    normalized <= 0
  ) {
    throw new Error(
      `deterministic validation failed: '${fieldName}' must be a positive integer`
    );
  }

  return normalized;
}

function validateStringField(value: unknown, fieldName: string): string {
  if (typeof value !== "string") {
    throw new Error(
      `deterministic validation failed: '${fieldName}' must be a non-empty string`
    );
  }

  const trimmed = value.trim();

  if (!trimmed) {
    throw new Error(
      `deterministic validation failed: '${fieldName}' must be a non-empty string`
    );
  }

  return trimmed;
}

function validateOptionalStringField(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : fallback;
}

function validateArray(value: unknown, fieldName: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(
      `deterministic validation failed: '${fieldName}' must be an array`
    );
  }
  return value;
}

function validateStringArray(
  value: unknown,
  fieldName: string,
  options: {
    nonEmpty?: boolean;
    defaultEmpty?: boolean;
    acceptSingleString?: boolean;
  } = {}
): string[] {
  const rawItems =
    value === undefined && options.defaultEmpty
      ? []
      : typeof value === "string" && options.acceptSingleString
        ? [value]
        : validateArray(value, fieldName);
  const array = rawItems.map((item, index) =>
    validateStringField(item, `${fieldName}[${index}]`)
  );
  if (options.nonEmpty && array.length === 0) {
    throw new Error(
      `deterministic validation failed: '${fieldName}' must be a non-empty array`
    );
  }
  return array;
}

function validateEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fieldName: string
): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new Error(
      `deterministic validation failed: '${fieldName}' must be one of ${allowed.join(", ")}`
    );
  }
  return value as T;
}

function validateSemanticGateArray(
  value: unknown,
  fieldName: string
): SemanticGateId[] {
  return validateArray(value, fieldName).map((item, index) =>
    validateEnum<SemanticGateId>(
      item,
      VALID_SEMANTIC_GATES,
      `${fieldName}[${index}]`
    )
  );
}

function defaultLoopControlReason(action: LoopAction): string {
  return action === "rerun"
    ? "semantic rerun requested"
    : "semantic validation accepted";
}

/**
 * Parse responseText as JSON and assert it is a non-null, non-array object.
 * `topLevelShapeMessage` is the human-readable description of the expected shape
 * (e.g. "top-level payload must be an object with a 'findings' array"); it is
 * appended to the standard "deterministic validation failed: " prefix when the
 * parsed value is not an object.
 */
function parseTopLevelObject(
  responseText: string,
  topLevelShapeMessage: string
): Record<string, unknown> {
  const parseableText = extractParseableJsonObject(responseText);
  if (parseableText === undefined) {
    throw new Error(
      "deterministic validation failed: response is not valid JSON"
    );
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(parseableText);
  } catch {
    throw new Error(
      "deterministic validation failed: response is not valid JSON"
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `deterministic validation failed: ${topLevelShapeMessage}`
    );
  }

  return parsed as Record<string, unknown>;
}

function extractParseableJsonObject(responseText: string): string | undefined {
  const trimmed = responseText.replace(/^\uFEFF/u, "").trim();

  if (!trimmed) {
    return undefined;
  }

  if (canParse(trimmed)) {
    return trimmed;
  }

  const fenced = extractWrappingJsonFence(trimmed);
  if (fenced !== undefined && canParse(fenced)) {
    return fenced;
  }

  const extracted = extractSingleRootObject(trimmed);
  return extracted.status === "single" && canParse(extracted.text)
    ? extracted.text
    : undefined;
}

function canParse(value: string): boolean {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

function extractWrappingJsonFence(value: string): string | undefined {
  const match = value.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/u);
  return match?.[1]?.trim();
}

function extractSingleRootObject(
  value: string
):
  | { readonly status: "none" }
  | { readonly status: "multiple" }
  | { readonly status: "single"; readonly text: string } {
  const spans: { start: number; end: number }[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
      continue;
    }
    if (char === "}") {
      if (depth === 0) {
        return { status: "none" };
      }
      depth -= 1;
      if (depth === 0 && start >= 0) {
        spans.push({ start, end: index + 1 });
        start = -1;
      }
    }
  }

  if (depth !== 0 || spans.length === 0) {
    return { status: "none" };
  }
  if (spans.length > 1) {
    return { status: "multiple" };
  }
  const span = spans[0];
  if (!span) {
    return { status: "none" };
  }
  return { status: "single", text: value.slice(span.start, span.end) };
}

const VALID_CANDIDATE_PRIORITIES: readonly CandidatePriority[] =
  RUNTIME_CANDIDATE_PRIORITIES;

const VALID_HYPOTHESIS_CLOSURE_STATUSES: readonly HypothesisClosureStatus[] =
  RUNTIME_HYPOTHESIS_CLOSURE_STATUSES;

const VALID_VALIDATION_DECISIONS: readonly ValidationDecision[] =
  RUNTIME_VALIDATION_DECISIONS;

const VALID_SEMANTIC_GATES: readonly SemanticGateId[] =
  RUNTIME_SEMANTIC_GATE_IDS;

const VALID_SUPPLEMENTAL_LENSES: readonly SupplementalLens[] =
  RUNTIME_SUPPLEMENTAL_LENSES;

const VALID_LOOP_ACTIONS: readonly LoopAction[] = RUNTIME_LOOP_ACTIONS;
