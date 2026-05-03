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

function extractReportableFindingId(input: unknown): string | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }

  const value = (input as Record<string, unknown>).findingId;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
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
