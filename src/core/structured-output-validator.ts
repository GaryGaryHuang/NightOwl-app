import type {
  DependencyPathException,
  DispositionReason,
  DispositionStatus,
  Finding,
  FindingDisposition,
  FindingsPayload,
  FindingTraceability,
  VerifiedFindingsPayload
} from "./file-review-context.ts";
import type { ReviewBasisV1 } from "./review-basis.ts";
import type {
  CandidateClassification,
  CandidateConfidence,
  CandidateFindingV3,
  CandidateFindingsResult,
  CandidateFindingsV3,
  CandidatePriority,
  CandidateSeverity,
  CriticalMissingInformation,
  EvidenceStrength,
  HypothesisClosure,
  HypothesisClosureStatus,
  LoopAction,
  LoopControl,
  MissingInformationItem,
  PerFindingValidationResult,
  SemanticGateId,
  StopReason,
  ValidationDecision,
  ValidationOverallStatus,
  ValidationReportV1
} from "./semantic-review.ts";
import {
  CANDIDATE_CLASSIFICATIONS as RUNTIME_CANDIDATE_CLASSIFICATIONS,
  CANDIDATE_CONFIDENCES as RUNTIME_CANDIDATE_CONFIDENCES,
  CANDIDATE_FINDINGS_RESULTS as RUNTIME_CANDIDATE_FINDINGS_RESULTS,
  CANDIDATE_PRIORITIES as RUNTIME_CANDIDATE_PRIORITIES,
  CANDIDATE_SEVERITIES as RUNTIME_CANDIDATE_SEVERITIES,
  EVIDENCE_STRENGTHS as RUNTIME_EVIDENCE_STRENGTHS,
  HYPOTHESIS_CLOSURE_STATUSES as RUNTIME_HYPOTHESIS_CLOSURE_STATUSES,
  LOOP_ACTIONS as RUNTIME_LOOP_ACTIONS,
  SEMANTIC_GATE_IDS as RUNTIME_SEMANTIC_GATE_IDS,
  STOP_REASONS as RUNTIME_STOP_REASONS,
  VALIDATION_DECISIONS as RUNTIME_VALIDATION_DECISIONS,
  VALIDATION_OVERALL_STATUSES as RUNTIME_VALIDATION_OVERALL_STATUSES
} from "./semantic-review.ts";
import {
  buildFindingAnchorValidationContext,
  type FindingAnchorValidationContext
} from "./finding-anchor-context.ts";
import {
  verifyFindingAnchor,
  type AnchorVerificationFailure
} from "./finding-anchor-verifier.ts";
import {
  DISPOSITION_REASONS,
  type VerifierReportEntry
} from "./verifier-report.ts";

export class StructuredValidationReportError extends Error {
  readonly report: readonly VerifierReportEntry[];

  constructor(message: string, report: readonly VerifierReportEntry[]) {
    super(message);
    this.name = "StructuredValidationReportError";
    this.report = report.map((entry) => ({ ...entry }));
  }
}

interface FindingValidationResult {
  readonly finding: Finding;
  readonly anchorFailure?: AnchorVerificationFailure;
}

interface TraceabilityValidationResult {
  readonly traceability: FindingTraceability;
  readonly anchorFailure?: AnchorVerificationFailure;
}

/**
 * Deterministically validate structured findings JSON before it is written into review state.
 */
export class StructuredOutputValidator {
  validate(input: {
    responseText: string;
    diffContent?: string;
    filePath?: string;
  }): FindingsPayload {
    const record = parseTopLevelObject(
      input.responseText,
      "top-level payload must be an object with a 'findings' array"
    );

    if (!("findings" in record) || !Array.isArray(record.findings)) {
      throw new Error(
        "deterministic validation failed: top-level payload must be an object with a 'findings' array"
      );
    }

    rejectUnknownFields(record, ALLOWED_TOP_LEVEL_KEYS, "top-level payload");
    const schemaVersion = validateSchemaVersion(record.schemaVersion);

    const anchorContext = buildAnchorContext(input);
    const validatedFindings = record.findings.map(
      (finding) =>
        validateFindingWithDiagnostics(finding, anchorContext).finding
    );

    assertUniqueFindingIds(validatedFindings, "findings");

    return {
      schemaVersion,
      findings: validatedFindings
    };
  }

  filterByAcceptance(payload: FindingsPayload): FindingsPayload {
    return {
      schemaVersion: payload.schemaVersion,
      findings: payload.findings.filter((finding) =>
        this.#classifyAcceptance(finding).accepted
      )
    };
  }

  validateWithReport(input: {
    responseText: string;
    diffContent?: string;
    filePath?: string;
  }): { payload: FindingsPayload; report: VerifierReportEntry[] } {
    const record = parseTopLevelObject(
      input.responseText,
      "top-level payload must be an object with a 'findings' array"
    );

    if (!("findings" in record) || !Array.isArray(record.findings)) {
      throw new Error(
        "deterministic validation failed: top-level payload must be an object with a 'findings' array"
      );
    }

    rejectUnknownFields(record, ALLOWED_TOP_LEVEL_KEYS, "top-level payload");
    const schemaVersion = validateSchemaVersion(record.schemaVersion);

    const anchorContext = buildAnchorContext(input);
    const validatedFindings: Finding[] = [];
    const report: VerifierReportEntry[] = [];
    const seenFindingIds = new Set<string>();

    for (const rawFinding of record.findings) {
      const reportableFindingId = extractReportableFindingId(rawFinding);

      if (reportableFindingId === undefined) {
        validatedFindings.push(validateFinding(rawFinding, anchorContext));
        continue;
      }

      if (seenFindingIds.has(reportableFindingId)) {
        report.push({
          findingId: reportableFindingId,
          taxonomy: "DUPLICATE",
          outcome: "rejected",
          gate: "schema",
          reason: `duplicate findingId '${reportableFindingId}'`
        });
        continue;
      }
      seenFindingIds.add(reportableFindingId);

      try {
        const validated = validateFindingWithDiagnostics(rawFinding, anchorContext);
        validatedFindings.push(validated.finding);
        report.push({
          findingId: validated.finding.findingId,
          taxonomy: "OK",
          outcome: "accepted",
          gate: "schema",
          reason: "passed schema validation"
        });
        if (validated.anchorFailure) {
          report.push(createAnchorWarningReportEntry(
            validated.finding.findingId,
            validated.anchorFailure
          ));
        }
      } catch (error) {
        report.push(createRejectedValidationReportEntry(reportableFindingId, error));
      }
    }

    const hasValidationRejection = report.some(
      (entry) =>
        entry.outcome === "rejected" &&
        entry.gate === "schema"
    );
    if (hasValidationRejection) {
      throw new StructuredValidationReportError(
        "deterministic validation failed: one or more findings failed schema validation",
        report
      );
    }

    assertUniqueFindingIds(validatedFindings, "findings");

    return {
      payload: {
        schemaVersion,
        findings: validatedFindings
      },
      report
    };
  }

  filterByAcceptanceWithReport(payload: FindingsPayload): {
    payload: FindingsPayload;
    report: VerifierReportEntry[];
  } {
    const accepted: Finding[] = [];
    const report: VerifierReportEntry[] = [];

    for (const finding of payload.findings) {
      const classification = this.#classifyAcceptance(finding);

      report.push({
        findingId: finding.findingId,
        taxonomy: classification.taxonomy,
        outcome: classification.accepted ? "accepted" : "rejected",
        gate: "acceptance",
        reason: classification.reason
      });

      if (classification.accepted) {
        accepted.push(finding);
      }
    }

    return { payload: { schemaVersion: payload.schemaVersion, findings: accepted }, report };
  }

  #classifyAcceptance(finding: Finding): {
    accepted: boolean;
    taxonomy: VerifierReportEntry["taxonomy"];
    reason: string;
  } {
    return {
      accepted: true,
      taxonomy: "OK",
      reason: "passed all acceptance gates"
    };
  }

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
        reviewBasis: input.reviewBasis,
        anchorContext: buildAnchorContext(input),
        report
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
          taxonomy: reason.includes("schemaVersion") ? "SCHEMA" : "SEMANTIC",
          outcome: "rejected",
          gate: reason.includes("schemaVersion") ? "schema" : "semantic",
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
        reviewBasis: input.reviewBasis,
        anchorContext: buildAnchorContext(input),
        report
      });
      const payload = validateValidationReportV1Record({
        record,
        candidatePayload,
        anchorContext: buildAnchorContext(input),
        report
      });

      const validationResultByFindingId = new Map(
        payload.perFindingResults.map((result) => [result.findingId, result])
      );

      for (const finding of payload.approvedFindings) {
        const validationResult = validationResultByFindingId.get(
          finding.findingId
        );
        report.push({
          findingId: finding.findingId,
          taxonomy: "OK",
          outcome: "accepted",
          gate: "schema",
          reason: "passed ValidationReportV1 schema validation"
        });
        report.push({
          findingId: finding.findingId,
          taxonomy: "OK",
          outcome: "accepted",
          gate: "semantic",
          reason: "passed ValidationReportV1 semantic gates",
          ...buildValidationReportSemanticFields(validationResult, payload)
        });
      }

      if (payload.approvedFindings.length === 0) {
        for (const result of payload.perFindingResults) {
          report.push({
            findingId: result.findingId,
            taxonomy: result.decision === "approve" ? "OK" : "SEMANTIC",
            outcome: result.decision === "approve" ? "accepted" : "rejected",
            gate: "semantic",
            reason: result.reason ?? `candidate ${result.decision}`,
            ...buildValidationReportSemanticFields(result, payload)
          });
        }
      }

      return { payload, report };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (report.length === 0 || report.every((entry) => entry.outcome !== "rejected")) {
        report.push({
          findingId: extractReportableFindingIdFromText(input.responseText) ?? "<payload>",
          taxonomy: reason.includes("schemaVersion") ? "SCHEMA" : "SEMANTIC",
          outcome: "rejected",
          gate: reason.includes("schemaVersion") ? "schema" : "semantic",
          reason
        });
      }
      throw new StructuredValidationReportError(
        "deterministic validation failed: ValidationReportV1 failed validation",
        report
      );
    }
  }

  validateWithDispositions(input: {
    responseText: string;
    diffContent?: string;
    filePath?: string;
  }): VerifiedFindingsPayload {
    return this.validateWithDispositionsAndReport(input).payload;
  }

  validateWithDispositionsAndReport(input: {
    responseText: string;
    diffContent?: string;
    filePath?: string;
  }): { payload: VerifiedFindingsPayload; report: VerifierReportEntry[] } {
    const record = parseTopLevelObject(
      input.responseText,
      "top-level payload must be an object with 'findingUpdates' and 'dispositions' arrays"
    );

    if (!("findingUpdates" in record) || !Array.isArray(record.findingUpdates)) {
      throw new Error(
        "deterministic validation failed: top-level payload must be an object with 'findingUpdates' and 'dispositions' arrays"
      );
    }

    if (!("dispositions" in record) || !Array.isArray(record.dispositions)) {
      throw new Error(
        "deterministic validation failed: top-level payload must contain a 'dispositions' array"
      );
    }

    rejectUnknownFields(
      record,
      ALLOWED_VERIFIED_TOP_LEVEL_KEYS,
      "top-level payload"
    );
    const schemaVersion = validateSchemaVersion(record.schemaVersion);

    const anchorContext = buildAnchorContext(input);
    const report: VerifierReportEntry[] = [];
    const validatedFindingUpdates = record.findingUpdates.map((finding) => {
      const validated = validateFindingWithDiagnostics(finding, anchorContext);
      report.push({
        findingId: validated.finding.findingId,
        taxonomy: "OK",
        outcome: "accepted",
        gate: "schema",
        reason: "passed schema validation"
      });
      if (validated.anchorFailure) {
        report.push(createAnchorWarningReportEntry(
          validated.finding.findingId,
          validated.anchorFailure
        ));
      }
      return validated.finding;
    });

    assertUniqueFindingIds(validatedFindingUpdates, "findings");

    const validatedDispositions = record.dispositions.map((d, index) =>
      validateDisposition(d, index)
    );

    assertUniqueFindingIds(validatedDispositions, "dispositions");

    return {
      payload: {
        schemaVersion,
        findingUpdates: validatedFindingUpdates,
        dispositions: validatedDispositions
      },
      report
    };
  }

  validateDispositionCompleteness(input: {
    dispositions: FindingDisposition[];
    candidateFindingIds: readonly string[];
    acceptedFindingIds: readonly string[];
    findingUpdateIds: readonly string[];
  }): void {
    const dispositionMap = new Map(
      input.dispositions.map((d) => [d.findingId, d])
    );
    const candidateIdSet = new Set(input.candidateFindingIds);
    const findingUpdateIdSet = new Set(input.findingUpdateIds);

    // Every candidate must have a disposition
    for (const candidateId of input.candidateFindingIds) {
      if (!dispositionMap.has(candidateId)) {
        throw new Error(
          `deterministic validation failed: missing disposition for candidate findingId '${candidateId}'`
        );
      }
    }

    // Step 6 dispositions account only for candidate findings from the previous step.
    for (const d of input.dispositions) {
      if (!candidateIdSet.has(d.findingId)) {
        throw new Error(
          `deterministic validation failed: disposition references unknown candidate findingId '${d.findingId}'`
        );
      }
    }

    // Retained/modified must appear in findings; retired must not
    const acceptedIdSet = new Set(input.acceptedFindingIds);
    for (const d of input.dispositions) {
      validateCandidateDispositionReason(d);

      if (
        (d.status === "retained" || d.status === "retired") &&
        findingUpdateIdSet.has(d.findingId)
      ) {
        throw new Error(
          `deterministic validation failed: ${d.status} candidate '${d.findingId}' must not appear in findingUpdates`
        );
      }

      if (d.status === "modified" && !findingUpdateIdSet.has(d.findingId)) {
        throw new Error(
          `deterministic validation failed: modified candidate '${d.findingId}' must appear in findingUpdates`
        );
      }

      if (
        (d.status === "retained" || d.status === "modified") &&
        !acceptedIdSet.has(d.findingId)
      ) {
        throw new Error(
          `deterministic validation failed: ${d.status} candidate '${d.findingId}' must appear in findings`
        );
      }

      if (d.status === "retired" && acceptedIdSet.has(d.findingId)) {
        throw new Error(
          `deterministic validation failed: retired candidate '${d.findingId}' must not appear in findings`
        );
      }
    }
  }
}

function validateCandidateDispositionReason(disposition: FindingDisposition): void {
  if (
    (disposition.status === "retained" || disposition.status === "modified") &&
    disposition.reason !== "SUPPORTED"
  ) {
    throw new Error(
      `deterministic validation failed: ${disposition.status} candidate '${disposition.findingId}' must use disposition reason 'SUPPORTED'`
    );
  }

  if (
    disposition.status === "retired" &&
    disposition.reason === "SUPPORTED"
  ) {
    throw new Error(
      `deterministic validation failed: retired candidate '${disposition.findingId}' must not use disposition reason 'SUPPORTED'`
    );
  }
}

function buildValidationReportSemanticFields(
  result: PerFindingValidationResult | undefined,
  payload: ValidationReportV1
): Partial<VerifierReportEntry> {
  const missingInformationItem =
    result === undefined
      ? undefined
      : payload.missingInformationItems.find(
          (item) => item.findingId === result.findingId
        );

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
      : { requiredCorrections: [...result.requiredCorrections] }),
    ...(result?.recommendedClassification === undefined
      ? {}
      : { recommendedClassification: result.recommendedClassification }),
    ...(result?.recommendedPriority === undefined
      ? {}
      : { recommendedPriority: result.recommendedPriority }),
    ...(result?.recommendedSeverity === undefined
      ? {}
      : { recommendedSeverity: result.recommendedSeverity }),
    ...(missingInformationItem?.itemId === undefined
      ? {}
      : { missingInformationItemId: missingInformationItem.itemId }),
    ...(payload.stopReason === "repeated_unsupported_claim" &&
    result?.findingId !== undefined
      ? { repeatedUnsupportedClaimId: result.findingId }
      : {}),
    ...(payload.stopReason === undefined ? {} : { stopReason: payload.stopReason })
  };
}

function validateCandidateFindingsV3Record(input: {
  record: Record<string, unknown>;
  reviewBasis: ReviewBasisV1;
  anchorContext: FindingAnchorValidationContext | undefined;
  report: VerifierReportEntry[];
}): CandidateFindingsV3 {
  rejectUnknownFields(
    input.record,
    ALLOWED_CANDIDATE_TOP_LEVEL_KEYS,
    "CandidateFindingsV3"
  );

  if (input.record.schemaVersion !== 3) {
    throw new Error(
      "deterministic validation failed: CandidateFindingsV3 schemaVersion must be 3"
    );
  }

  const result = validateEnum<CandidateFindingsResult>(
    input.record.result,
    VALID_CANDIDATE_RESULTS,
    "result"
  );
  const findings = validateArray(input.record.findings, "findings").map(
    (finding, index) =>
      validateCandidateFindingV3({
        input: finding,
        index,
        reviewBasis: input.reviewBasis,
        anchorContext: input.anchorContext,
        report: input.report
      })
  );
  assertUniqueFindingIds(findings, "findings");

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
  validateCandidateFindingsResultConsistency({
    result,
    findings,
    criticalMissingInformation
  });

  return {
    schemaVersion: 3,
    result,
    findings,
    hypothesisClosure,
    criticalMissingInformation
  };
}

function validateCandidateFindingV3(input: {
  input: unknown;
  index: number;
  reviewBasis: ReviewBasisV1;
  anchorContext: FindingAnchorValidationContext | undefined;
  report: VerifierReportEntry[];
}): CandidateFindingV3 {
  if (!input.input || typeof input.input !== "object" || Array.isArray(input.input)) {
    throw new Error(
      `deterministic validation failed: findings[${input.index}] must be a non-null object`
    );
  }

  const record = input.input as Record<string, unknown>;
  rejectUnknownFields(
    record,
    ALLOWED_CANDIDATE_FINDING_KEYS,
    `findings[${input.index}]`
  );

  const findingId = validateStringField(record.findingId, "findingId");
  const sourceHypothesisIds = validateStringArray(
    record.sourceHypothesisIds,
    "sourceHypothesisIds",
    { nonEmpty: true }
  );
  const reviewBasisHypothesisIds = new Set(
    input.reviewBasis.hypothesisLedger.map((h) => h.hypothesisId)
  );
  for (const hypothesisId of sourceHypothesisIds) {
    if (!reviewBasisHypothesisIds.has(hypothesisId)) {
      throw new Error(
        `deterministic validation failed: sourceHypothesisId ${hypothesisId} is not present in ReviewBasisV1 hypothesisLedger`
      );
    }
  }

  const classification = validateEnum<CandidateClassification>(
    record.classification,
    VALID_CANDIDATE_CLASSIFICATIONS,
    "classification"
  );
  const priority = validateEnum<CandidatePriority>(
    record.priority,
    VALID_CANDIDATE_PRIORITIES,
    "priority"
  );
  const severity = validateEnum<CandidateSeverity>(
    record.severity,
    VALID_CANDIDATE_SEVERITIES,
    "severity"
  );
  const confidence = validateEnum<CandidateConfidence>(
    record.confidence,
    VALID_CANDIDATE_CONFIDENCES,
    "confidence"
  );
  const evidenceStrength = validateEnum<EvidenceStrength>(
    record.evidenceStrength,
    VALID_EVIDENCE_STRENGTHS,
    "evidenceStrength"
  );

  validateClassificationPrioritySeverity({
    classification,
    priority,
    severity
  });

  const dependencyPathException = validateDependencyPathException(
    record.dependencyPathException
  );
  const traceabilityResult = validateTraceability(
    record.traceability,
    input.anchorContext,
    dependencyPathException
  );
  if (traceabilityResult.anchorFailure) {
    input.report.push({
      findingId,
      taxonomy: "ANCHOR",
      outcome: "rejected",
      gate: "semantic",
      reason: formatAnchorFailure("traceability", traceabilityResult.anchorFailure)
    });
    throw new Error(formatAnchorFailure("traceability", traceabilityResult.anchorFailure));
  }

  const codeEvidence = validateCodeEvidenceArray(
    record.codeEvidence,
    input.reviewBasis
  );
  const executionPath = validateStringArray(
    record.executionPath,
    "executionPath",
    { nonEmpty: classification === "confirmed_problem" }
  );
  const triggerCondition = validateStringField(
    record.triggerCondition,
    "triggerCondition"
  );
  const failureMechanism = validateStringField(
    record.failureMechanism,
    "failureMechanism"
  );
  const impact = validateStringField(record.impact, "impact");
  const counterEvidenceChecked = validateStringArray(
    record.counterEvidenceChecked,
    "counterEvidenceChecked",
    { nonEmpty: classification === "confirmed_problem" }
  );
  const reproducibility = validateStringField(
    record.reproducibility,
    "reproducibility"
  );
  const fixDirection = validateStringField(record.fixDirection, "fixDirection");
  const testRecommendation = validateStringField(
    record.testRecommendation,
    "testRecommendation"
  );

  if (classification === "confirmed_problem" && codeEvidence.length === 0) {
    throw new Error(
      "deterministic validation failed: confirmed_problem requires non-empty codeEvidence"
    );
  }

  return {
    findingId,
    sourceHypothesisIds,
    classification,
    priority,
    severity,
    confidence,
    evidenceStrength,
    title: validateStringField(record.title, "title"),
    traceability: traceabilityResult.traceability,
    codeEvidence,
    executionPath,
    triggerCondition,
    failureMechanism,
    impact,
    counterEvidenceChecked,
    reproducibility,
    fixDirection,
    testRecommendation
  };
}

function validateValidationReportV1Record(input: {
  record: Record<string, unknown>;
  candidatePayload: CandidateFindingsV3;
  anchorContext: FindingAnchorValidationContext | undefined;
  report: VerifierReportEntry[];
}): ValidationReportV1 {
  rejectUnknownFields(
    input.record,
    ALLOWED_VALIDATION_REPORT_TOP_LEVEL_KEYS,
    "ValidationReportV1"
  );

  if (input.record.schemaVersion !== 1) {
    throw new Error(
      "deterministic validation failed: ValidationReportV1 schemaVersion must be 1"
    );
  }

  const overallStatus = validateEnum<ValidationOverallStatus>(
    input.record.overallStatus,
    VALID_VALIDATION_OVERALL_STATUSES,
    "overallStatus"
  );
  const candidateIds = input.candidatePayload.findings.map((f) => f.findingId);
  const candidateIdSet = new Set(candidateIds);
  const perFindingResults = validateArray(
    input.record.perFindingResults,
    "perFindingResults"
  ).map((item, index) =>
    validatePerFindingValidationResult(item, index, candidateIdSet)
  );
  assertPerFindingResultsCoverCandidates(perFindingResults, candidateIds);

  const approvedFindings = validateArray(
    input.record.approvedFindings,
    "approvedFindings"
  ).map((finding, index) => {
    const validated = validateFindingWithDiagnostics(
      finding,
      input.anchorContext
    ).finding;
    if (!candidateIdSet.has(validated.findingId)) {
      throw new Error(
        `deterministic validation failed: ${validated.findingId} in approvedFindings must reference a Step 5 candidate`
      );
    }
    return validated;
  });
  assertUniqueFindingIds(approvedFindings, "findings");
  assertApprovedFindingsMatchDecisions(perFindingResults, approvedFindings);

  const missingInformationItems = validateArray(
    input.record.missingInformationItems,
    "missingInformationItems"
  ).map((item, index) => validateMissingInformationItem(item, index, candidateIdSet));
  assertValidationReportMatchesCandidatePayload({
    candidatePayload: input.candidatePayload,
    perFindingResults,
    approvedFindings,
    missingInformationItems
  });

  const loopControl = validateLoopControl(input.record.loopControl);
  const stopReason =
    input.record.stopReason === undefined
      ? undefined
      : validateEnum<StopReason>(
          input.record.stopReason,
          VALID_STOP_REASONS,
          "stopReason"
        );
  validateLoopControlStatusAlignment({
    overallStatus,
    approvedFindings,
    loopControl,
    stopReason
  });

  return {
    schemaVersion: 1,
    overallStatus,
    perFindingResults,
    approvedFindings,
    missingInformationItems,
    loopControl,
    ...(stopReason === undefined ? {} : { stopReason })
  };
}

function validateLoopControlStatusAlignment(input: {
  overallStatus: ValidationOverallStatus;
  approvedFindings: readonly Finding[];
  loopControl: LoopControl;
  stopReason: StopReason | undefined;
}): void {
  if (input.overallStatus === "PASS" && input.loopControl.action !== "accept") {
    throw new Error(
      "deterministic validation failed: overallStatus PASS requires loopControl.action accept"
    );
  }

  if (
    input.overallStatus === "RERUN_STEP5" &&
    input.loopControl.action !== "rerun_step5"
  ) {
    throw new Error(
      "deterministic validation failed: overallStatus RERUN_STEP5 requires loopControl.action rerun_step5"
    );
  }

  if (
    (input.overallStatus === "INSUFFICIENT_INFORMATION_FOR_RELIABLE_REVIEW" ||
      input.overallStatus === "STOPPED") &&
    input.loopControl.action !== "stop"
  ) {
    throw new Error(
      "deterministic validation failed: stopped or insufficient-information ValidationReportV1 requires loopControl.action stop"
    );
  }

  if (input.loopControl.action === "accept" && input.stopReason !== undefined) {
    throw new Error(
      "deterministic validation failed: accepted ValidationReportV1 must not include stopReason"
    );
  }

  if (input.loopControl.action === "rerun_step5") {
    if (input.stopReason !== undefined) {
      throw new Error(
        "deterministic validation failed: rerun_step5 ValidationReportV1 must not include stopReason"
      );
    }
    if (input.approvedFindings.length > 0) {
      throw new Error(
        "deterministic validation failed: rerun_step5 ValidationReportV1 must not approve findings before semantic validation accepts them"
      );
    }
  }

  if (input.loopControl.action === "stop" && input.stopReason === undefined) {
    throw new Error(
      "deterministic validation failed: stopped ValidationReportV1 requires stopReason"
    );
  }
}

function validateClassificationPrioritySeverity(input: {
  classification: CandidateClassification;
  priority: CandidatePriority;
  severity: CandidateSeverity;
}): void {
  if (input.classification === "reasonable_risk" && input.priority === "must") {
    throw new Error(
      "deterministic validation failed: reasonable_risk cannot use priority must"
    );
  }

  if (input.classification === "reasonable_risk" && input.severity === "high") {
    throw new Error(
      "deterministic validation failed: reasonable_risk cannot use severity high"
    );
  }

  if (input.classification === "insufficient_information" && input.priority === "must") {
    throw new Error(
      "deterministic validation failed: insufficient_information cannot use priority must"
    );
  }

  if (input.classification === "insufficient_information" && input.severity !== "none") {
    throw new Error(
      "deterministic validation failed: insufficient_information severity must be none"
    );
  }
}

function validateCodeEvidenceArray(
  input: unknown,
  reviewBasis: ReviewBasisV1
): CandidateFindingV3["codeEvidence"] {
  const evidenceRefs = new Set(reviewBasis.evidenceRefs.map((ref) => ref.evidenceId));
  return validateArray(input, "codeEvidence").map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(
        `deterministic validation failed: codeEvidence[${index}] must be a non-null object`
      );
    }
    const record = item as Record<string, unknown>;
    rejectUnknownFields(
      record,
      ALLOWED_CODE_EVIDENCE_KEYS,
      `codeEvidence[${index}]`
    );
    const evidenceId = validateStringField(
      record.evidenceId,
      `codeEvidence[${index}].evidenceId`
    );
    if (!evidenceRefs.has(evidenceId)) {
      throw new Error(
        `deterministic validation failed: evidenceId ${evidenceId} is not present in ReviewBasisV1 evidenceRefs`
      );
    }
    return {
      evidenceId,
      location: validateStringField(record.location, `codeEvidence[${index}].location`),
      summary: validateStringField(record.summary, `codeEvidence[${index}].summary`)
    };
  });
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
  rejectUnknownFields(
    record,
    ALLOWED_HYPOTHESIS_CLOSURE_KEYS,
    `hypothesisClosure[${index}]`
  );
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
    evidenceIds: validateStringArray(
      record.evidenceIds,
      `hypothesisClosure[${index}].evidenceIds`
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
  const closureIds = new Set(closures.map((closure) => closure.hypothesisId));
  for (const hypothesis of reviewBasis.hypothesisLedger) {
    if (!closureIds.has(hypothesis.hypothesisId)) {
      throw new Error(
        `deterministic validation failed: ${hypothesis.hypothesisId} missing from hypothesisClosure`
      );
    }
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
  rejectUnknownFields(
    record,
    ALLOWED_CRITICAL_MISSING_INFORMATION_KEYS,
    `criticalMissingInformation[${index}]`
  );
  const result: CriticalMissingInformation = {
    itemId: validateStringField(record.itemId, `criticalMissingInformation[${index}].itemId`),
    description: validateStringField(record.description, `criticalMissingInformation[${index}].description`),
    whyItMatters: validateStringField(record.whyItMatters, `criticalMissingInformation[${index}].whyItMatters`)
  };
  if (record.sourceHypothesisIds !== undefined) {
    result.sourceHypothesisIds = validateStringArray(
      record.sourceHypothesisIds,
      `criticalMissingInformation[${index}].sourceHypothesisIds`
    );
  }
  return result;
}

function validateCandidateFindingsResultConsistency(input: {
  result: CandidateFindingsResult;
  findings: readonly CandidateFindingV3[];
  criticalMissingInformation: readonly CriticalMissingInformation[];
}): void {
  if (input.result === "FINDINGS_READY" && input.findings.length === 0) {
    throw new Error(
      "deterministic validation failed: CandidateFindingsV3 result FINDINGS_READY requires at least one finding"
    );
  }

  if (input.result === "NO_FINDINGS" && input.findings.length > 0) {
    throw new Error(
      "deterministic validation failed: CandidateFindingsV3 result NO_FINDINGS must not include findings"
    );
  }

  if (
    input.result === "INSUFFICIENT_INFORMATION" &&
    input.criticalMissingInformation.length === 0
  ) {
    throw new Error(
      "deterministic validation failed: CandidateFindingsV3 result INSUFFICIENT_INFORMATION requires criticalMissingInformation"
    );
  }
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
  rejectUnknownFields(
    record,
    ALLOWED_PER_FINDING_RESULT_KEYS,
    `perFindingResults[${index}]`
  );
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
      `perFindingResults[${index}].requiredCorrections`
    )
  };

  if (record.recommendedClassification !== undefined) {
    result.recommendedClassification = validateEnum<CandidateClassification>(
      record.recommendedClassification,
      VALID_CANDIDATE_CLASSIFICATIONS,
      `perFindingResults[${index}].recommendedClassification`
    );
  }
  if (record.recommendedPriority !== undefined) {
    result.recommendedPriority = validateEnum<CandidatePriority>(
      record.recommendedPriority,
      VALID_CANDIDATE_PRIORITIES,
      `perFindingResults[${index}].recommendedPriority`
    );
  }
  if (record.recommendedSeverity !== undefined) {
    result.recommendedSeverity = validateEnum<CandidateSeverity>(
      record.recommendedSeverity,
      VALID_CANDIDATE_SEVERITIES,
      `perFindingResults[${index}].recommendedSeverity`
    );
  }
  if (record.reason !== undefined) {
    result.reason = validateStringField(
      record.reason,
      `perFindingResults[${index}].reason`
    );
  }

  return result;
}

function assertPerFindingResultsCoverCandidates(
  results: readonly PerFindingValidationResult[],
  candidateIds: readonly string[]
): void {
  const resultIds = new Set(results.map((result) => result.findingId));
  for (const candidateId of candidateIds) {
    if (!resultIds.has(candidateId)) {
      throw new Error(
        `deterministic validation failed: candidate ${candidateId} is missing from perFindingResults`
      );
    }
  }
}

function assertApprovedFindingsMatchDecisions(
  results: readonly PerFindingValidationResult[],
  approvedFindings: readonly Finding[]
): void {
  const approvedIds = new Set(approvedFindings.map((finding) => finding.findingId));
  for (const result of results) {
    if (result.decision === "approve" && !approvedIds.has(result.findingId)) {
      throw new Error(
        `deterministic validation failed: approve candidate ${result.findingId} must appear in approvedFindings`
      );
    }
    if (result.decision !== "approve" && approvedIds.has(result.findingId)) {
      throw new Error(
        `deterministic validation failed: ${result.decision} candidate ${result.findingId} must not appear in approvedFindings`
      );
    }
  }
}

function assertValidationReportMatchesCandidatePayload(input: {
  candidatePayload: CandidateFindingsV3;
  perFindingResults: readonly PerFindingValidationResult[];
  approvedFindings: readonly Finding[];
  missingInformationItems: readonly MissingInformationItem[];
}): void {
  const hasApproval =
    input.approvedFindings.length > 0 ||
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
  index: number,
  candidateIdSet: ReadonlySet<string>
): MissingInformationItem {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(
      `deterministic validation failed: missingInformationItems[${index}] must be a non-null object`
    );
  }
  const record = input as Record<string, unknown>;
  rejectUnknownFields(
    record,
    ALLOWED_MISSING_INFORMATION_ITEM_KEYS,
    `missingInformationItems[${index}]`
  );
  const result: MissingInformationItem = {
    itemId: validateStringField(record.itemId, `missingInformationItems[${index}].itemId`),
    description: validateStringField(record.description, `missingInformationItems[${index}].description`),
    whyItMatters: validateStringField(record.whyItMatters, `missingInformationItems[${index}].whyItMatters`)
  };
  if (record.findingId !== undefined) {
    const findingId = validateStringField(
      record.findingId,
      `missingInformationItems[${index}].findingId`
    );
    if (!candidateIdSet.has(findingId)) {
      throw new Error(
        `deterministic validation failed: missingInformationItems entry ${findingId} references unknown candidate`
      );
    }
    result.findingId = findingId;
  }
  return result;
}

function validateLoopControl(input: unknown): { action: LoopAction; reason: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(
      "deterministic validation failed: loopControl must be a non-null object"
    );
  }
  const record = input as Record<string, unknown>;
  rejectUnknownFields(record, ALLOWED_LOOP_CONTROL_KEYS, "loopControl");
  return {
    action: validateEnum<LoopAction>(
      record.action,
      VALID_LOOP_ACTIONS,
      "loopControl.action"
    ),
    reason: validateStringField(record.reason, "loopControl.reason")
  };
}

function coerceCandidateFindingsV3ForValidation(input: {
  input: CandidateFindingsV3 | Record<string, unknown>;
  reviewBasis: ReviewBasisV1 | undefined;
  anchorContext: FindingAnchorValidationContext | undefined;
  report: VerifierReportEntry[];
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

  return validateCandidateFindingsV3Record({
    record: input.input as Record<string, unknown>,
    reviewBasis: input.reviewBasis,
    anchorContext: input.anchorContext,
    report: input.report
  });
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
      : Array.isArray(record.approvedFindings)
        ? record.approvedFindings
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

function createRejectedValidationReportEntry(
  findingId: string,
  error: unknown
): VerifierReportEntry {
  const reason = error instanceof Error ? error.message : String(error);

  if (reason.includes("[ANCHOR]")) {
    return {
      findingId,
      taxonomy: "ANCHOR",
      outcome: "rejected",
      gate: "anchor",
      reason
    };
  }

  return {
    findingId,
    taxonomy: "SCHEMA",
    outcome: "rejected",
    gate: "schema",
    reason
  };
}

function createAnchorWarningReportEntry(
  findingId: string,
  failure: AnchorVerificationFailure
): VerifierReportEntry {
  return {
    findingId,
    taxonomy: "ANCHOR",
    outcome: "accepted",
    gate: "anchor",
    reason: `warning: ${formatAnchorFailure("traceability", failure)}`
  };
}

function validateFinding(
  input: unknown,
  anchorContext: FindingAnchorValidationContext | undefined
): Finding {
  return validateFindingWithDiagnostics(input, anchorContext).finding;
}

function validateFindingWithDiagnostics(
  input: unknown,
  anchorContext: FindingAnchorValidationContext | undefined
): FindingValidationResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(
      "deterministic validation failed: each finding must be a non-null object"
    );
  }

  const finding = input as Record<string, unknown>;

  rejectUnknownFields(finding, ALLOWED_FINDING_KEYS, "finding");

  const type = validateStringField(finding.type, "type");
  const title = validateStringField(finding.title, "title");
  const dependencyPathException = validateDependencyPathException(
    finding.dependencyPathException
  );
  const traceabilityResult = validateTraceability(
    finding.traceability,
    anchorContext,
    dependencyPathException
  );
  const { traceability } = traceabilityResult;
  const expectedBehavior = validateStringField(
    finding.expectedBehavior,
    "expectedBehavior"
  );
  const actualBehavior = validateStringField(
    finding.actualBehavior,
    "actualBehavior"
  );
  const deviation = validateStringField(finding.deviation, "deviation");
  const impact = validateStringField(finding.impact, "impact");
  const suggestion = validateStringField(finding.suggestion, "suggestion");
  const findingId = validateStringField(finding.findingId, "findingId");
  if (type !== "must" && type !== "nice") {
    throw new Error(
      "deterministic validation failed: 'type' must be 'must' or 'nice'"
    );
  }

  const result: Finding = {
    type,
    title,
    traceability,
    expectedBehavior,
    actualBehavior,
    deviation,
    impact,
    suggestion,
    findingId
  };

  if (dependencyPathException) {
    result.dependencyPathException = dependencyPathException;
  }

  if (finding.sourceHypothesisId !== undefined) {
    result.sourceHypothesisId = validateStringField(
      finding.sourceHypothesisId,
      "sourceHypothesisId"
    );
  }

  return {
    finding: result,
    ...(traceabilityResult.anchorFailure === undefined
      ? {}
      : { anchorFailure: traceabilityResult.anchorFailure })
  };
}

function validateTraceability(
  input: unknown,
  anchorContext: FindingAnchorValidationContext | undefined,
  dependencyPathException: DependencyPathException | undefined
): TraceabilityValidationResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(
      "deterministic validation failed: 'traceability' must be a non-null object"
    );
  }

  const traceability = input as Record<string, unknown>;
  const kind = validateStringField(traceability.kind, "traceability.kind");

  if (kind === "line-range") {
    rejectUnknownFields(
      traceability,
      ALLOWED_TRACEABILITY_LINE_RANGE_KEYS,
      "traceability"
    );

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

    if (anchorContext) {
      const verdict = verifyFindingAnchor({
        traceability: resolved,
        anchorContext,
        ...(dependencyPathException === undefined
          ? {}
          : { dependencyPathException })
      });

      if (!verdict.ok) {
        return {
          traceability: resolved,
          anchorFailure: verdict
        };
      }
    }

    return { traceability: resolved };
  }

  if (kind === "diff-hunk") {
    rejectUnknownFields(
      traceability,
      ALLOWED_TRACEABILITY_DIFF_HUNK_KEYS,
      "traceability"
    );

    const hunkHeader = validateStringField(
      traceability.hunkHeader,
      "traceability.hunkHeader"
    );

    const resolved: FindingTraceability = {
      kind,
      hunkHeader
    };

    if (anchorContext) {
      const verdict = verifyFindingAnchor({
        traceability: resolved,
        anchorContext
      });

      if (!verdict.ok) {
        return {
          traceability: resolved,
          anchorFailure: verdict
        };
      }

      return { traceability: resolved };
    }

    return { traceability: resolved };
  }

  throw new Error(
    "deterministic validation failed: unsupported traceability kind"
  );
}

function validateDependencyPathException(
  input: unknown
): DependencyPathException | undefined {
  if (input === undefined) {
    return undefined;
  }

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(
      "deterministic validation failed: 'dependencyPathException' must be a non-null object"
    );
  }

  const exception = input as Record<string, unknown>;

  rejectUnknownFields(
    exception,
    ALLOWED_DEPENDENCY_PATH_EXCEPTION_KEYS,
    "dependencyPathException"
  );

  const reason = validateStringField(
    exception.reason,
    "dependencyPathException.reason"
  );

  const dependencyAnchor = exception.dependencyAnchor;
  if (
    !dependencyAnchor ||
    typeof dependencyAnchor !== "object" ||
    Array.isArray(dependencyAnchor)
  ) {
    throw new Error(
      "deterministic validation failed: 'dependencyPathException.dependencyAnchor' must be a non-null object"
    );
  }

  const anchor = dependencyAnchor as Record<string, unknown>;

  rejectUnknownFields(
    anchor,
    ALLOWED_DEPENDENCY_ANCHOR_KEYS,
    "dependencyPathException.dependencyAnchor"
  );

  const filePath = validateStringField(
    anchor.filePath,
    "dependencyPathException.dependencyAnchor.filePath"
  );

  const result: DependencyPathException = {
    reason,
    dependencyAnchor: { filePath }
  };

  if (anchor.symbol !== undefined) {
    const symbol = validateStringField(
      anchor.symbol,
      "dependencyPathException.dependencyAnchor.symbol"
    );
    result.dependencyAnchor.symbol = symbol;
  }

  return result;
}

function formatAnchorFailure(
  fieldName: string,
  failure: AnchorVerificationFailure
): string {
  return `deterministic validation failed: '${fieldName}' [${failure.tag}] ${failure.detail}`;
}

function validatePositiveInteger(value: unknown, fieldName: string): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value <= 0
  ) {
    throw new Error(
      `deterministic validation failed: '${fieldName}' must be a positive integer`
    );
  }

  return value;
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
  options: { nonEmpty?: boolean } = {}
): string[] {
  const array = validateArray(value, fieldName).map((item, index) =>
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

function validateSchemaVersion(value: unknown): 2 {
  if (value !== 2) {
    throw new Error(
      "deterministic validation failed: 'schemaVersion' must be 2"
    );
  }

  return 2;
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
  let parsed: unknown;

  try {
    parsed = JSON.parse(responseText);
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

/**
 * Build a finding-anchor validation context from a step-resolve input, returning
 * undefined when the caller did not supply diff content (e.g. test fixtures).
 */
function buildAnchorContext(input: {
  diffContent?: string;
  filePath?: string;
}): FindingAnchorValidationContext | undefined {
  if (input.diffContent === undefined) {
    return undefined;
  }

  return buildFindingAnchorValidationContext(
    input.filePath ?? "<unknown>",
    input.diffContent
  );
}

/**
 * Throw on the first duplicate findingId encountered. `scope` is either
 * "findings" (legacy message preserved for finding arrays and Step 6 updates)
 * or "dispositions" (suffixed message preserved for the
 * dispositions array).
 */
function assertUniqueFindingIds(
  items: ReadonlyArray<{ findingId: string }>,
  scope: "findings" | "dispositions"
): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.findingId)) {
      const suffix = scope === "dispositions" ? " in dispositions" : "";
      throw new Error(
        `deterministic validation failed: duplicate findingId '${item.findingId}'${suffix}`
      );
    }
    seen.add(item.findingId);
  }
}

// --- Allowed-key constants ---

const ALLOWED_TOP_LEVEL_KEYS = ["schemaVersion", "findings"] as const;

const ALLOWED_FINDING_KEYS = [
  "type",
  "title",
  "traceability",
  "expectedBehavior",
  "actualBehavior",
  "deviation",
  "impact",
  "suggestion",
  "dependencyPathException",
  "findingId",
  "sourceHypothesisId"
] as const;

const ALLOWED_TRACEABILITY_LINE_RANGE_KEYS = [
  "kind",
  "lineStart",
  "lineEnd"
] as const;

const ALLOWED_TRACEABILITY_DIFF_HUNK_KEYS = ["kind", "hunkHeader"] as const;

const ALLOWED_DEPENDENCY_PATH_EXCEPTION_KEYS = [
  "reason",
  "dependencyAnchor"
] as const;

const ALLOWED_DEPENDENCY_ANCHOR_KEYS = ["filePath", "symbol"] as const;

const ALLOWED_VERIFIED_TOP_LEVEL_KEYS = [
  "schemaVersion",
  "findingUpdates",
  "dispositions"
] as const;

const ALLOWED_CANDIDATE_TOP_LEVEL_KEYS = [
  "schemaVersion",
  "result",
  "findings",
  "hypothesisClosure",
  "criticalMissingInformation"
] as const;

const ALLOWED_CANDIDATE_FINDING_KEYS = [
  "findingId",
  "sourceHypothesisIds",
  "classification",
  "priority",
  "severity",
  "confidence",
  "evidenceStrength",
  "title",
  "traceability",
  "dependencyPathException",
  "codeEvidence",
  "executionPath",
  "triggerCondition",
  "failureMechanism",
  "impact",
  "counterEvidenceChecked",
  "reproducibility",
  "fixDirection",
  "testRecommendation"
] as const;

const ALLOWED_CODE_EVIDENCE_KEYS = [
  "evidenceId",
  "location",
  "summary"
] as const;

const ALLOWED_HYPOTHESIS_CLOSURE_KEYS = [
  "hypothesisId",
  "status",
  "evidenceIds",
  "rationale"
] as const;

const ALLOWED_CRITICAL_MISSING_INFORMATION_KEYS = [
  "itemId",
  "description",
  "whyItMatters",
  "sourceHypothesisIds"
] as const;

const ALLOWED_VALIDATION_REPORT_TOP_LEVEL_KEYS = [
  "schemaVersion",
  "overallStatus",
  "perFindingResults",
  "approvedFindings",
  "missingInformationItems",
  "loopControl",
  "stopReason"
] as const;

const ALLOWED_PER_FINDING_RESULT_KEYS = [
  "findingId",
  "decision",
  "failedGates",
  "requiredCorrections",
  "recommendedClassification",
  "recommendedPriority",
  "recommendedSeverity",
  "reason"
] as const;

const ALLOWED_MISSING_INFORMATION_ITEM_KEYS = [
  "itemId",
  "findingId",
  "description",
  "whyItMatters"
] as const;

const ALLOWED_LOOP_CONTROL_KEYS = ["action", "reason"] as const;

const ALLOWED_DISPOSITION_KEYS = [
  "findingId",
  "status",
  "reason",
  "explanation"
] as const;

const VALID_DISPOSITION_STATUSES: readonly string[] = [
  "retained",
  "modified",
  "retired"
];

const VALID_DISPOSITION_REASONS: readonly string[] = DISPOSITION_REASONS;

const VALID_CANDIDATE_RESULTS: readonly CandidateFindingsResult[] =
  RUNTIME_CANDIDATE_FINDINGS_RESULTS;

const VALID_CANDIDATE_CLASSIFICATIONS: readonly CandidateClassification[] =
  RUNTIME_CANDIDATE_CLASSIFICATIONS;

const VALID_CANDIDATE_PRIORITIES: readonly CandidatePriority[] =
  RUNTIME_CANDIDATE_PRIORITIES;

const VALID_CANDIDATE_SEVERITIES: readonly CandidateSeverity[] =
  RUNTIME_CANDIDATE_SEVERITIES;

const VALID_CANDIDATE_CONFIDENCES: readonly CandidateConfidence[] =
  RUNTIME_CANDIDATE_CONFIDENCES;

const VALID_EVIDENCE_STRENGTHS: readonly EvidenceStrength[] =
  RUNTIME_EVIDENCE_STRENGTHS;

const VALID_HYPOTHESIS_CLOSURE_STATUSES: readonly HypothesisClosureStatus[] =
  RUNTIME_HYPOTHESIS_CLOSURE_STATUSES;

const VALID_VALIDATION_OVERALL_STATUSES: readonly ValidationOverallStatus[] =
  RUNTIME_VALIDATION_OVERALL_STATUSES;

const VALID_VALIDATION_DECISIONS: readonly ValidationDecision[] =
  RUNTIME_VALIDATION_DECISIONS;

const VALID_SEMANTIC_GATES: readonly SemanticGateId[] =
  RUNTIME_SEMANTIC_GATE_IDS;

const VALID_LOOP_ACTIONS: readonly LoopAction[] = RUNTIME_LOOP_ACTIONS;

const VALID_STOP_REASONS: readonly StopReason[] = RUNTIME_STOP_REASONS;

// --- Helper functions ---

function rejectUnknownFields(
  input: Record<string, unknown>,
  allowedKeys: readonly string[],
  objectName: string
): void {
  const allowed = new Set(allowedKeys);
  const extra = Object.keys(input).filter((key) => !allowed.has(key));

  if (extra.length > 0) {
    throw new Error(
      `deterministic validation failed: unknown field(s) in ${objectName}: ${extra.join(", ")}`
    );
  }
}

function validateDisposition(
  input: unknown,
  index: number
): FindingDisposition {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(
      `deterministic validation failed: dispositions[${index}] must be a non-null object`
    );
  }

  const record = input as Record<string, unknown>;

  rejectUnknownFields(record, ALLOWED_DISPOSITION_KEYS, `dispositions[${index}]`);

  const findingId = validateStringField(record.findingId, `dispositions[${index}].findingId`);
  const status = record.status;

  if (typeof status !== "string" || !VALID_DISPOSITION_STATUSES.includes(status)) {
    throw new Error(
      `deterministic validation failed: 'dispositions[${index}].status' must be one of 'retained', 'modified', 'retired'`
    );
  }

  const reason = validateDispositionReason(
    record.reason,
    `dispositions[${index}].reason`
  );
  const explanation = validateStringField(record.explanation, `dispositions[${index}].explanation`);

  return {
    findingId,
    status: status as DispositionStatus,
    reason,
    explanation
  };
}

function validateDispositionReason(
  value: unknown,
  fieldName: string
): DispositionReason {
  if (
    typeof value !== "string" ||
    !VALID_DISPOSITION_REASONS.includes(value)
  ) {
    throw new Error(
      `deterministic validation failed: '${fieldName}' must be one of 'SUPPORTED', 'ANCHOR', 'EVIDENCE', 'REACHABILITY', 'OUT_OF_SCOPE', 'DUPLICATE', 'CONTRADICTION'`
    );
  }

  return value as DispositionReason;
}
