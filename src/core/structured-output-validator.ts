import {
  DEFAULT_CONFIDENCE_THRESHOLDS,
  type ConfidenceThresholds
} from "./confidence-thresholds.ts";
import { buildDiffAnchorMap, type DiffAnchorMap } from "./diff-anchor-map.ts";
import type {
  DependencyPathException,
  DispositionStatus,
  EvidenceRef,
  Finding,
  FindingDisposition,
  FindingsPayload,
  FindingTraceability,
  Reachability,
  UncertaintyStatus,
  VerifiedFindingsPayload
} from "./file-review-context.ts";
import {
  verifyFindingAnchor,
  type AnchorVerificationFailure
} from "./finding-anchor-verifier.ts";

export interface StructuredOutputValidatorOptions {
  confidenceThresholds?: ConfidenceThresholds;
}

/**
 * Deterministically validate structured findings JSON before it is written into review state.
 */
export class StructuredOutputValidator {
  readonly #confidenceThresholds: ConfidenceThresholds;

  constructor(options: StructuredOutputValidatorOptions = {}) {
    this.#confidenceThresholds = options.confidenceThresholds ?? {
      ...DEFAULT_CONFIDENCE_THRESHOLDS
    };
  }

  validate(input: {
    responseText: string;
    diffContent?: string;
    filePath?: string;
  }): FindingsPayload {
    let parsed: unknown;

    try {
      parsed = JSON.parse(input.responseText);
    } catch {
      throw new Error(
        "deterministic validation failed: response is not valid JSON"
      );
    }

    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      !("findings" in parsed)
    ) {
      throw new Error(
        "deterministic validation failed: top-level payload must be an object with a 'findings' array"
      );
    }

    const findings = (parsed as { findings: unknown }).findings;

    if (!Array.isArray(findings)) {
      throw new Error(
        "deterministic validation failed: top-level payload must be an object with a 'findings' array"
      );
    }

    rejectUnknownFields(
      parsed as Record<string, unknown>,
      ALLOWED_TOP_LEVEL_KEYS,
      "top-level payload"
    );

    const diffAnchorMap =
      input.diffContent === undefined
        ? undefined
        : buildDiffAnchorMap(input.filePath ?? "<unknown>", input.diffContent);
    const hunkHeaders = collectUnifiedDiffHunkHeaders(input.diffContent);
    const validatedFindings = findings.map((finding) =>
      validateFinding(finding, hunkHeaders, diffAnchorMap)
    );

    const seenIds = new Set<string>();
    for (const f of validatedFindings) {
      if (seenIds.has(f.findingId)) {
        throw new Error(
          `deterministic validation failed: duplicate findingId '${f.findingId}'`
        );
      }
      seenIds.add(f.findingId);
    }

    return { findings: validatedFindings };
  }

  filterByAcceptance(payload: FindingsPayload): FindingsPayload {
    return {
      findings: payload.findings.filter((finding) => {
        if (finding.uncertaintyStatus !== "supported") return false;
        if (!finding.reachability.credible) return false;
        return finding.type === "must"
          ? finding.confidence >= this.#confidenceThresholds.must
          : finding.confidence >= this.#confidenceThresholds.nice;
      })
    };
  }

  validateWithDispositions(input: {
    responseText: string;
    diffContent?: string;
    filePath?: string;
  }): VerifiedFindingsPayload {
    let parsed: unknown;

    try {
      parsed = JSON.parse(input.responseText);
    } catch {
      throw new Error(
        "deterministic validation failed: response is not valid JSON"
      );
    }

    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      throw new Error(
        "deterministic validation failed: top-level payload must be an object with 'findings' and 'dispositions' arrays"
      );
    }

    const record = parsed as Record<string, unknown>;

    if (!("findings" in record)) {
      throw new Error(
        "deterministic validation failed: top-level payload must be an object with 'findings' and 'dispositions' arrays"
      );
    }

    if (!("dispositions" in record)) {
      throw new Error(
        "deterministic validation failed: top-level payload must contain a 'dispositions' array"
      );
    }

    rejectUnknownFields(
      record,
      ALLOWED_VERIFIED_TOP_LEVEL_KEYS,
      "top-level payload"
    );

    const findings = record.findings;

    if (!Array.isArray(findings)) {
      throw new Error(
        "deterministic validation failed: top-level payload must be an object with 'findings' and 'dispositions' arrays"
      );
    }

    const dispositionsRaw = record.dispositions;

    if (!Array.isArray(dispositionsRaw)) {
      throw new Error(
        "deterministic validation failed: top-level payload must contain a 'dispositions' array"
      );
    }

    const diffAnchorMap =
      input.diffContent === undefined
        ? undefined
        : buildDiffAnchorMap(input.filePath ?? "<unknown>", input.diffContent);
    const hunkHeaders = collectUnifiedDiffHunkHeaders(input.diffContent);
    const validatedFindings = findings.map((finding) =>
      validateFinding(finding, hunkHeaders, diffAnchorMap)
    );

    const seenFindingIds = new Set<string>();
    for (const f of validatedFindings) {
      if (seenFindingIds.has(f.findingId)) {
        throw new Error(
          `deterministic validation failed: duplicate findingId '${f.findingId}'`
        );
      }
      seenFindingIds.add(f.findingId);
    }

    const validatedDispositions = dispositionsRaw.map((d, index) =>
      validateDisposition(d, index)
    );

    const seenDispositionIds = new Set<string>();
    for (const d of validatedDispositions) {
      if (seenDispositionIds.has(d.findingId)) {
        throw new Error(
          `deterministic validation failed: duplicate findingId '${d.findingId}' in dispositions`
        );
      }
      seenDispositionIds.add(d.findingId);
    }

    return { findings: validatedFindings, dispositions: validatedDispositions };
  }

  validateDispositionCompleteness(input: {
    dispositions: FindingDisposition[];
    candidateFindingIds: readonly string[];
    acceptedFindingIds: readonly string[];
  }): void {
    const dispositionMap = new Map(
      input.dispositions.map((d) => [d.findingId, d])
    );
    const acceptedIdSet = new Set(input.acceptedFindingIds);
    const candidateIdSet = new Set(input.candidateFindingIds);

    // Every candidate must have a disposition
    for (const candidateId of input.candidateFindingIds) {
      if (!dispositionMap.has(candidateId)) {
        throw new Error(
          `deterministic validation failed: missing disposition for candidate findingId '${candidateId}'`
        );
      }
    }

    // Check for unknown dispositions (not a candidate AND not a new finding)
    for (const d of input.dispositions) {
      if (!candidateIdSet.has(d.findingId) && !acceptedIdSet.has(d.findingId)) {
        throw new Error(
          `deterministic validation failed: disposition references unknown candidate findingId '${d.findingId}'`
        );
      }
    }

    // Retained/modified must appear in findings; retired must not
    for (const d of input.dispositions) {
      if (!candidateIdSet.has(d.findingId)) {
        continue; // new-finding dispositions are not subject to these checks
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

function validateFinding(
  input: unknown,
  hunkHeaders: Set<string>,
  diffAnchorMap: DiffAnchorMap | undefined
): Finding {
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
  const traceability = validateTraceability(
    finding.traceability,
    hunkHeaders,
    diffAnchorMap,
    dependencyPathException
  );
  const context = validateStringField(finding.context, "context");
  const deviation = validateStringField(finding.deviation, "deviation");
  const impact = validateStringField(finding.impact, "impact");
  const suggestion = validateStringField(finding.suggestion, "suggestion");
  const confidence = finding.confidence;
  const findingId = validateStringField(finding.findingId, "findingId");
  const validatedEvidence = validateSupportingEvidence(finding.supportingEvidence);
  const validatedReachability = validateReachability(finding.reachability);
  const validatedUncertaintyStatus = validateUncertaintyStatus(finding.uncertaintyStatus);

  if (type !== "must" && type !== "nice") {
    throw new Error(
      "deterministic validation failed: 'type' must be 'must' or 'nice'"
    );
  }

  if (
    typeof confidence !== "number" ||
    Number.isNaN(confidence) ||
    confidence < 0 ||
    confidence > 100
  ) {
    throw new Error(
      "deterministic validation failed: 'confidence' must be a number between 0 and 100"
    );
  }

  const result: Finding = {
    type,
    title,
    traceability,
    context,
    deviation,
    impact,
    suggestion,
    confidence,
    findingId,
    supportingEvidence: validatedEvidence,
    reachability: validatedReachability,
    uncertaintyStatus: validatedUncertaintyStatus
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

  return result;
}

function validateTraceability(
  input: unknown,
  hunkHeaders: Set<string>,
  diffAnchorMap: DiffAnchorMap | undefined,
  dependencyPathException: DependencyPathException | undefined
): FindingTraceability {
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

    if (diffAnchorMap) {
      const verdict = verifyFindingAnchor({
        traceability: resolved,
        diffAnchorMap,
        ...(dependencyPathException === undefined
          ? {}
          : { dependencyPathException })
      });

      if (!verdict.ok) {
        throw new Error(formatAnchorFailure("traceability", verdict));
      }
    }

    return resolved;
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

    if (diffAnchorMap) {
      const verdict = verifyFindingAnchor({
        traceability: resolved,
        diffAnchorMap
      });

      if (!verdict.ok) {
        throw new Error(formatAnchorFailure("traceability", verdict));
      }

      return resolved;
    }

    if (!hunkHeaders.has(hunkHeader)) {
      throw new Error(
        "deterministic validation failed: 'traceability.hunkHeader' not found in diff"
      );
    }

    return resolved;
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

function collectUnifiedDiffHunkHeaders(diffContent?: string): Set<string> {
  if (!diffContent) {
    return new Set();
  }

  return new Set(
    diffContent
      .split("\n")
      .filter((line) => /^@@ .* @@(?: .*|)$/u.test(line.trim()))
      .map((line) => line.trim())
  );
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

// --- Allowed-key constants ---

const ALLOWED_TOP_LEVEL_KEYS = ["findings"] as const;

const ALLOWED_FINDING_KEYS = [
  "type",
  "title",
  "traceability",
  "context",
  "deviation",
  "impact",
  "suggestion",
  "confidence",
  "dependencyPathException",
  "findingId",
  "supportingEvidence",
  "reachability",
  "uncertaintyStatus",
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

const ALLOWED_EVIDENCE_REF_KEYS = ["source", "content"] as const;

const ALLOWED_REACHABILITY_KEYS = ["credible", "description"] as const;

const VALID_UNCERTAINTY_STATUSES: readonly string[] = [
  "supported",
  "tentative",
  "unsupported",
  "out_of_scope"
];

const ALLOWED_VERIFIED_TOP_LEVEL_KEYS = ["findings", "dispositions"] as const;

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

function validateSupportingEvidence(input: unknown): EvidenceRef[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error(
      "deterministic validation failed: 'supportingEvidence' must be a non-empty array"
    );
  }

  return input.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(
        `deterministic validation failed: 'supportingEvidence[${index}]' must be a non-null object`
      );
    }

    const record = item as Record<string, unknown>;

    rejectUnknownFields(
      record,
      ALLOWED_EVIDENCE_REF_KEYS,
      `supportingEvidence[${index}]`
    );

    const source = validateStringField(
      record.source,
      `supportingEvidence[${index}].source`
    );
    const content = validateStringField(
      record.content,
      `supportingEvidence[${index}].content`
    );

    return { source, content };
  });
}

function validateReachability(input: unknown): Reachability {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(
      "deterministic validation failed: 'reachability' must be a non-null object"
    );
  }

  const record = input as Record<string, unknown>;

  rejectUnknownFields(record, ALLOWED_REACHABILITY_KEYS, "reachability");

  if (typeof record.credible !== "boolean") {
    throw new Error(
      "deterministic validation failed: 'reachability.credible' must be a boolean"
    );
  }

  const description = validateStringField(
    record.description,
    "reachability.description"
  );

  return { credible: record.credible, description };
}

function validateUncertaintyStatus(input: unknown): UncertaintyStatus {
  if (
    typeof input !== "string" ||
    !VALID_UNCERTAINTY_STATUSES.includes(input)
  ) {
    throw new Error(
      "deterministic validation failed: 'uncertaintyStatus' must be one of 'supported', 'tentative', 'unsupported', 'out_of_scope'"
    );
  }

  return input as UncertaintyStatus;
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

  const reason = validateStringField(record.reason, `dispositions[${index}].reason`);
  const explanation = validateStringField(record.explanation, `dispositions[${index}].explanation`);

  return {
    findingId,
    status: status as DispositionStatus,
    reason,
    explanation
  };
}
