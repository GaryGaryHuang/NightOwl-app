import {
  DEFAULT_CONFIDENCE_THRESHOLDS,
  type ConfidenceThresholds
} from "./confidence-thresholds.ts";
import { buildDiffAnchorMap, type DiffAnchorMap } from "./diff-anchor-map.ts";
import type {
  DependencyPathException,
  EvidenceRef,
  Finding,
  FindingsPayload,
  FindingTraceability,
  Reachability,
  UncertaintyStatus
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
