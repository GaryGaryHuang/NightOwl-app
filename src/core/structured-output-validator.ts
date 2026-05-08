import type {
  DependencyPathException,
  FindingTraceability
} from "./file-review-context.ts";
import type { ReviewBasisV1 } from "./review-basis.ts";
import type {
  CandidateClassification,
  CandidateFindingV3,
  CandidateFindingsResult,
  CandidateFindingsV3,
  CandidateSeverity,
  CriticalMissingInformation,
  HypothesisClosure,
  HypothesisClosureStatus,
  LoopAction,
  LoopControl,
  MissingInformationItem,
  PerFindingValidationResult,
  SemanticGateId,
  ValidationDecision,
  ValidationReportV1
} from "./semantic-review.ts";
import {
  CANDIDATE_CLASSIFICATIONS as RUNTIME_CANDIDATE_CLASSIFICATIONS,
  CANDIDATE_SEVERITIES as RUNTIME_CANDIDATE_SEVERITIES,
  HYPOTHESIS_CLOSURE_STATUSES as RUNTIME_HYPOTHESIS_CLOSURE_STATUSES,
  LOOP_ACTIONS as RUNTIME_LOOP_ACTIONS,
  SEMANTIC_GATE_IDS as RUNTIME_SEMANTIC_GATE_IDS,
  VALIDATION_DECISIONS as RUNTIME_VALIDATION_DECISIONS
} from "./semantic-review.ts";
import type { VerifierReportEntry } from "./verifier-report.ts";

export class StructuredValidationReportError extends Error {
  readonly report: readonly VerifierReportEntry[];

  constructor(message: string, report: readonly VerifierReportEntry[]) {
    super(message);
    this.name = "StructuredValidationReportError";
    this.report = report.map((entry) => ({ ...entry }));
  }
}

interface TraceabilityValidationResult {
  readonly traceability: FindingTraceability;
}

export class StructuredOutputValidator {
  validateCandidateFindingsV3WithReport(input: {
    responseText: string;
    reviewBasis: ReviewBasisV1;
    diffContent?: string;
    filePath?: string;
  }): { payload: CandidateFindingsV3; report: VerifierReportEntry[] } {
    const report: VerifierReportEntry[] = [];

    try {
      const record = parseTopLevelObject(
        input.responseText,
        "top-level payload must be an object with a CandidateFindingsV3 shape"
      );
      const payload = validateCandidateFindingsV3Record({
        record,
        reviewBasis: input.reviewBasis
      });

      for (const finding of payload.findings) {
        report.push({
          findingId: finding.findingId,
          taxonomy: "OK",
          outcome: "accepted",
          gate: "schema",
          reason: "passed CandidateFindingsV3 schema validation"
        });
        report.push({
          findingId: finding.findingId,
          taxonomy: "OK",
          outcome: "accepted",
          gate: "semantic",
          reason: "passed CandidateFindingsV3 semantic gates"
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
        "deterministic validation failed: CandidateFindingsV3 failed validation",
        report
      );
    }
  }

  validateValidationReportV1WithReport(input: {
    responseText: string;
    candidateFindings: CandidateFindingsV3 | Record<string, unknown>;
    reviewBasis?: ReviewBasisV1;
    diffContent?: string;
    filePath?: string;
  }): { payload: ValidationReportV1; report: VerifierReportEntry[] } {
    const report: VerifierReportEntry[] = [];

    try {
      const record = parseTopLevelObject(
        input.responseText,
        "top-level payload must be an object with a ValidationReportV1 shape"
      );
      const candidatePayload = coerceCandidateFindingsV3ForValidation({
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
          reason: result.reason,
          ...buildValidationReportSemanticFields(result, payload)
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

function buildValidationReportSemanticFields(
  result: PerFindingValidationResult | undefined,
  payload: ValidationReportV1
): Partial<VerifierReportEntry> {
  return {
    ...(result?.decision === undefined
      ? {}
      : { validationDecision: result.decision }),
    ...(result?.failedGates[0] === undefined
      ? {}
      : { semanticGate: result.failedGates[0] }),
    ...(result?.requiredCorrections === undefined ||
    result.requiredCorrections.length === 0
      ? {}
      : { requiredCorrections: [...result.requiredCorrections] })
  };
}

function validateCandidateFindingsV3Record(input: {
  record: Record<string, unknown>;
  reviewBasis: ReviewBasisV1;
}): CandidateFindingsV3 {
  const findings = validateArray(input.record.findings, "findings").map(
    (finding, index) =>
      validateCandidateFindingV3({
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

  const criticalMissingInformation = validateArray(
    input.record.criticalMissingInformation,
    "criticalMissingInformation"
  ).map((item, index) => validateCriticalMissingInformation(item, index));
  assertInsufficientHypothesesHaveCriticalMissingInformation({
    hypothesisClosure,
    criticalMissingInformation
  });

  // Auto-derive result
  const result: CandidateFindingsResult =
    findings.length > 0
      ? "FINDINGS_READY"
      : criticalMissingInformation.length > 0
        ? "INSUFFICIENT_INFORMATION"
        : "NO_FINDINGS";

  return {
    result,
    findings,
    hypothesisClosure,
    criticalMissingInformation
  };
}

function validateCandidateFindingV3(input: {
  input: unknown;
  index: number;
}): CandidateFindingV3 {
  if (!input.input || typeof input.input !== "object" || Array.isArray(input.input)) {
    throw new Error(
      `deterministic validation failed: findings[${input.index}] must be a non-null object`
    );
  }

  const record = input.input as Record<string, unknown>;
  const classification = validateEnum<CandidateClassification>(
    record.classification,
    VALID_CANDIDATE_CLASSIFICATIONS,
    "classification"
  );
  const severity = validateEnum<CandidateSeverity>(
    record.severity,
    VALID_CANDIDATE_SEVERITIES,
    "severity"
  );

  if (classification === "reasonable_risk" && severity !== "low") {
    throw new Error(
      "deterministic validation failed: 'reasonable_risk' classification requires severity 'low'"
    );
  }

  const dependencyPathException = validateDependencyPathException(
    record.dependencyPathException,
    `findings[${input.index}].dependencyPathException`
  );
  const traceabilityResult = validateTraceability(
    record.traceability
  );

  const evidence = validateStringField(record.evidence, "evidence");
  const triggerCondition = validateStringField(
    record.triggerCondition,
    "triggerCondition"
  );
  const impact = validateStringField(record.impact, "impact");
  const counterEvidence = validateStringArray(
    record.counterEvidence,
    "counterEvidence",
    { nonEmpty: classification === "confirmed_problem" }
  );

  return {
    findingId: "", // placeholder; overwritten by caller
    classification,
    severity,
    title: validateStringField(record.title, "title"),
    traceability: traceabilityResult.traceability,
    evidence,
    triggerCondition,
    impact,
    counterEvidence,
    ...(dependencyPathException === undefined
      ? {}
      : { dependencyPathException })
  };
}

function validateValidationReportV1Record(input: {
  record: Record<string, unknown>;
  candidatePayload: CandidateFindingsV3;
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
    const hasApproval = input.perFindingResults.some((r) => r.decision === "approve");
    if (hasApproval) {
      throw new Error(
        "deterministic validation failed: rerun ValidationReportV1 must not approve findings before semantic validation accepts them"
      );
    }
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
  reviewBasis: ReviewBasisV1
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
      `deterministic validation failed: ${hypothesisId} is not present in ReviewBasisV1 hypothesisLedger`
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
  reviewBasis: ReviewBasisV1
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

function assertValidationReportMatchesCandidatePayload(input: {
  candidatePayload: CandidateFindingsV3;
  perFindingResults: readonly PerFindingValidationResult[];
  missingInformationItems: readonly MissingInformationItem[];
}): void {
  const hasApproval =
    input.perFindingResults.some((result) => result.decision === "approve");

  if (input.candidatePayload.result !== "FINDINGS_READY" && hasApproval) {
    throw new Error(
      `deterministic validation failed: CandidateFindingsV3 result ${input.candidatePayload.result} cannot approve findings`
    );
  }

  if (
    input.candidatePayload.result === "INSUFFICIENT_INFORMATION" &&
    input.candidatePayload.criticalMissingInformation.length > 0 &&
    input.missingInformationItems.length === 0
  ) {
    throw new Error(
      "deterministic validation failed: CandidateFindingsV3 criticalMissingInformation must be represented in ValidationReportV1 missingInformationItems"
    );
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

function coerceCandidateFindingsV3ForValidation(input: {
  input: CandidateFindingsV3 | Record<string, unknown>;
  reviewBasis: ReviewBasisV1 | undefined;
}): CandidateFindingsV3 {
  if (!input.input || typeof input.input !== "object" || Array.isArray(input.input)) {
    throw new Error(
      "deterministic validation failed: candidateFindings must be CandidateFindingsV3"
    );
  }
  if (input.reviewBasis === undefined) {
    throw new Error(
      "deterministic validation failed: reviewBasis is required to validate complete CandidateFindingsV3 before ValidationReportV1"
    );
  }

  // Strip auto-generated fields before re-validation
  const { result, ...rawRecord } = input.input as Record<string, unknown>;
  if (Array.isArray(rawRecord.findings)) {
    rawRecord.findings = (rawRecord.findings as Record<string, unknown>[]).map(
      (f) => {
        const { findingId, ...rest } = f;
        return rest;
      }
    );
  }

  return validateCandidateFindingsV3Record({
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

function validateTraceability(input: unknown): TraceabilityValidationResult {
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

    const resolved: FindingTraceability = {
      kind,
      lineStart,
      lineEnd
    };

    return { traceability: resolved };
  }

  if (kind === "diff-hunk") {
    const hunkHeader = validateStringField(
      traceability.hunkHeader,
      "traceability.hunkHeader"
    );

    const resolved: FindingTraceability = {
      kind,
      hunkHeader
    };

    return { traceability: resolved };
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

const VALID_CANDIDATE_CLASSIFICATIONS: readonly CandidateClassification[] =
  RUNTIME_CANDIDATE_CLASSIFICATIONS;

const VALID_CANDIDATE_SEVERITIES: readonly CandidateSeverity[] =
  RUNTIME_CANDIDATE_SEVERITIES;

const VALID_HYPOTHESIS_CLOSURE_STATUSES: readonly HypothesisClosureStatus[] =
  RUNTIME_HYPOTHESIS_CLOSURE_STATUSES;

const VALID_VALIDATION_DECISIONS: readonly ValidationDecision[] =
  RUNTIME_VALIDATION_DECISIONS;

const VALID_SEMANTIC_GATES: readonly SemanticGateId[] =
  RUNTIME_SEMANTIC_GATE_IDS;

const VALID_LOOP_ACTIONS: readonly LoopAction[] = RUNTIME_LOOP_ACTIONS;
